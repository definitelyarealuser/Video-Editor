const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

/**
 * Thin wrappers around the ffmpeg/ffprobe binaries. No fluent-ffmpeg dependency;
 * the filter graph below is intricate enough that building the argv by hand is
 * easier to reason about than a builder API.
 */

// Vimeo re-transcodes everything you upload anyway, so the CRF choice here mostly trades
// render time for file size (and therefore upload time), not final viewer quality.
const VIDEO_QUALITY_PRESETS = { high: 18, balanced: 22, smaller: 27 };

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error(`"${cmd}" was not found on PATH. Install ffmpeg (which provides ffmpeg + ffprobe) and try again.`));
      } else {
        reject(err);
      }
    });
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        // Short, plain-English headline for the user; the raw ffmpeg/ffprobe output goes on
        // `.detail` instead of inline, so callers can offer it as an optional "technical
        // details" disclosure rather than dumping a wall of stderr into the main error text.
        const err = new Error(`ffmpeg reported an error while processing the file (exit code ${code}).`);
        err.detail = stderr.slice(-4000);
        reject(err);
      }
    });
  });
}

async function checkFfmpegAvailable() {
  try {
    await run('ffmpeg', ['-version']);
    await run('ffprobe', ['-version']);
    return true;
  } catch {
    return false;
  }
}

async function probe(filePath) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  const data = JSON.parse(stdout);
  const videoStream = (data.streams || []).find((s) => s.codec_type === 'video');
  const audioStream = (data.streams || []).find((s) => s.codec_type === 'audio');
  const duration =
    parseFloat(data.format && data.format.duration) ||
    parseFloat(videoStream && videoStream.duration) ||
    0;

  let fps = 30;
  if (videoStream && videoStream.r_frame_rate) {
    const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
    if (den) fps = num / den;
  }
  // Clamp to a sane, widely-supported range.
  if (!isFinite(fps) || fps <= 0) fps = 30;
  fps = Math.min(Math.max(fps, 15), 60);

  return {
    duration,
    width: (videoStream && videoStream.width) || 1920,
    height: (videoStream && videoStream.height) || 1080,
    fps,
    hasAudio: !!audioStream,
  };
}

/**
 * Builds the filter_complex graph that:
 *  1. Shows the PNG (start) for `startDuration` seconds
 *  2. Crossfades (duration `transition`) into the main video
 *  3. Crossfades (duration `transition`) into the PNG (end) for `endDuration` seconds
 *  4. Fades to black over `fadeOut` seconds at the very end
 * Audio is built in parallel, always ending up the same total length as the
 * picture: silence under the PNG segments, then either crossfaded the same
 * way as the video (`crossfadeAudio: true`) or hard-cut at the moment each
 * video transition starts/ends (`crossfadeAudio: false`). Optionally the
 * the sermon's own audio is loudness-normalized (EBU R128 `loudnorm`) before the
 * bookend silence is attached, and the whole thing fades out at the end.
 *
 * The MP3 export is a wholly separate ffmpeg pass (see buildAudioOnlyFilterGraph/
 * renderAudio below) - it doesn't touch the PNG or video streams at all, so it renders
 * much faster than the full MP4 and can be saved/published while the video is still going.
 */
function buildFilterGraph({
  width,
  height,
  fps,
  videoDuration,
  hasAudio,
  startDuration,
  endDuration,
  transition,
  fadeOut,
  crossfadeAudio,
  normalize,
  targetLufs,
}) {
  const totalDuration = startDuration + endDuration + videoDuration - 2 * transition;
  const offset1 = startDuration - transition;
  const offset2 = startDuration + videoDuration - 2 * transition;
  const fadeStart = totalDuration - fadeOut;

  const scalePad = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p`;

  const videoChain = [
    `[0:v]${scalePad}[img1v]`,
    `[2:v]${scalePad}[img2v]`,
    `[1:v]fps=${fps},format=yuv420p[mainv]`,
    `[img1v][mainv]xfade=transition=fade:duration=${transition}:offset=${offset1}[xv1]`,
    `[xv1][img2v]xfade=transition=fade:duration=${transition}:offset=${offset2}[xv2]`,
    `[xv2]fade=t=out:st=${fadeStart}:d=${fadeOut}:color=black[vout]`,
  ];

  const mainAudioSource = hasAudio
    ? `[1:a]aformat=sample_rates=48000:channel_layouts=stereo[maina]`
    : `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${videoDuration},asetpts=PTS-STARTPTS[maina]`;

  const audioChain = [mainAudioSource];

  // Normalized before the silent bookend holds are attached, not after. loudnorm here runs in its
  // single-pass streaming mode, where it adapts as audio flows through it - so feeding it several
  // seconds of digital silence first spends that adaptation on nothing and leaves the sermon
  // itself under-corrected. Measured: a -28 LUFS source aiming at -14 came out at -22 with the
  // silence in front, and lands on -14.2 without it. The error grew the quieter the source was,
  // so the weeks that most needed normalizing were the ones it helped least - and the MP3, which
  // has always normalized its own audio directly (see buildAudioOnlyFilterGraph), came out
  // correct meanwhile, so the same sermon could be published at two different levels.
  //
  // Normalizing the sermon audio on its own is also just the right question to ask: the bookend
  // silence isn't content, and how long it runs shouldn't change how loud the sermon ends up.
  let mainLabel = 'maina';
  if (normalize) {
    audioChain.push(`[maina]loudnorm=I=${targetLufs}:TP=-1.5:LRA=11[mainan]`);
    mainLabel = 'mainan';
  }

  if (crossfadeAudio) {
    audioChain.push(
      `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${startDuration},asetpts=PTS-STARTPTS[silence1]`,
      `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${endDuration},asetpts=PTS-STARTPTS[silence2]`,
      `[silence1][${mainLabel}]acrossfade=d=${transition}[xa1]`,
      `[xa1][silence2]acrossfade=d=${transition}[xa2]`
    );
  } else {
    // No blend: silence runs right up to the moment the video transition begins/ends,
    // then hard-cuts to/from the main audio. Segment lengths still sum to totalDuration.
    audioChain.push(
      `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${offset1},asetpts=PTS-STARTPTS[silence1]`,
      `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${endDuration - transition},asetpts=PTS-STARTPTS[silence2]`,
      `[silence1][${mainLabel}][silence2]concat=n=3:v=0:a=1[xa2]`
    );
  }

  audioChain.push(`[xa2]afade=t=out:st=${fadeStart}:d=${fadeOut}[aout]`);

  return {
    filterComplex: [...videoChain, ...audioChain].join(';'),
    totalDuration,
  };
}

/**
 * Builds the filter_complex for the standalone MP3 pass: just the clip's own audio (no
 * PNG-hold silence), fading up from silence and back down over `transition` seconds at each
 * end - mirroring the crossfade the picture does in the full render, regardless of that
 * render's own audio-crossfade toggle - with optional loudness normalization.
 */
function buildAudioOnlyFilterGraph({ videoDuration, hasAudio, transition, normalize, targetLufs }) {
  const mainAudioSource = hasAudio
    ? `[0:a]aformat=sample_rates=48000:channel_layouts=stereo[maina]`
    : `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${videoDuration},asetpts=PTS-STARTPTS[maina]`;

  const chain = [mainAudioSource];
  let label = 'maina';
  if (normalize) {
    chain.push(`[maina]loudnorm=I=${targetLufs}:TP=-1.5:LRA=11[mainan]`);
    label = 'mainan';
  }
  chain.push(
    `[${label}]afade=t=in:st=0:d=${transition}[faded]`,
    `[faded]afade=t=out:st=${videoDuration - transition}:d=${transition}[aout]`
  );

  return { filterComplex: chain.join(';') };
}

/**
 * Spawns ffmpeg with `-progress pipe:1` and reports fractional progress against
 * `totalDuration` as it runs. Shared by both the video and audio-only render passes.
 */
function runFfmpegRender(args, totalDuration, onProgress, failureMessage) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderrTail = '';

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      // A single chunk can carry several -progress blocks, so take the LAST timestamp in it
      // rather than the first - otherwise the reported position is however far behind the
      // newest one the chunk happened to contain. (out_time_ms is microseconds despite the
      // name, a long-standing ffmpeg quirk - hence dividing by 1e6, not 1e3.)
      const matches = text.match(/out_time_(?:ms|us)=(\d+)/g);
      if (matches && matches.length && onProgress) {
        const seconds = Number(matches[matches.length - 1].split('=')[1]) / 1e6;
        const fraction = totalDuration > 0 ? Math.min(seconds / totalDuration, 1) : 0;
        onProgress(fraction);
      }
      if (text.includes('progress=end') && onProgress) {
        onProgress(1);
      }
    });

    proc.stderr.on('data', (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-4000);
    });

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error('ffmpeg was not found on PATH. Install ffmpeg and try again.'));
      } else {
        reject(err);
      }
    });

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else {
        const err = new Error(failureMessage);
        err.detail = stderrTail;
        reject(err);
      }
    });
  });
}

/**
 * Kicks off the video (MP4) render. Calls onProgress(fractionComplete) periodically.
 * The MP3, if requested, is a separate pass - see renderAudio() below.
 */
function render({
  pngPath,
  videoPath,
  outputPath,
  trimStart,
  trimEnd,
  startDuration,
  endDuration,
  transition,
  fadeOut,
  crossfadeAudio,
  normalize,
  targetLufs,
  videoInfo,
  videoCrf = VIDEO_QUALITY_PRESETS.high,
  onProgress,
}) {
  const { filterComplex, totalDuration } = buildFilterGraph({
    width: videoInfo.width,
    height: videoInfo.height,
    fps: videoInfo.fps,
    videoDuration: videoInfo.duration,
    hasAudio: videoInfo.hasAudio,
    startDuration,
    endDuration,
    transition,
    fadeOut,
    crossfadeAudio,
    normalize,
    targetLufs,
  });

  const videoInputArgs =
    trimStart != null && trimEnd != null
      ? ['-ss', String(trimStart), '-to', String(trimEnd), '-i', videoPath]
      : ['-i', videoPath];

  const args = [
    '-y',
    '-loop', '1', '-t', String(startDuration), '-i', pngPath,
    ...videoInputArgs,
    '-loop', '1', '-t', String(endDuration), '-i', pngPath,
    '-filter_complex', filterComplex,
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', String(videoCrf),
    '-pix_fmt', 'yuv420p',
    // Tags the output as Rec.709 rather than leaving color metadata unspecified - doesn't
    // convert the actual pixel values (most footage is already effectively Rec.709 anyway),
    // just removes the guesswork for Vimeo's transcoder on ingest.
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-c:a', 'aac',
    '-b:a', '320k', // matches Vimeo's recommended source-upload audio bitrate
    '-movflags', '+faststart',
    '-progress', 'pipe:1',
    '-nostats',
    outputPath,
  ];

  return runFfmpegRender(
    args,
    totalDuration,
    onProgress,
    "The render failed partway through. This usually means the video file, trim range, or output settings didn't work together the way ffmpeg expected."
  );
}

/**
 * Kicks off the MP3 render - its own ffmpeg pass, entirely separate from the video (no PNG
 * inputs, no video decode at all). Deliberately run before the video render (see server/index.js)
 * since it's dramatically faster - just the clip's own audio, no libx264 encode involved - so
 * the MP3 can be saved and published to SoundCloud while the video is still going.
 */
function renderAudio({
  videoPath,
  outputPath,
  trimStart,
  trimEnd,
  transition,
  normalize,
  targetLufs,
  videoInfo,
  mp3Bitrate = 192,
  onProgress,
}) {
  const { filterComplex } = buildAudioOnlyFilterGraph({
    videoDuration: videoInfo.duration,
    hasAudio: videoInfo.hasAudio,
    transition,
    normalize,
    targetLufs,
  });

  const videoInputArgs =
    trimStart != null && trimEnd != null
      ? ['-ss', String(trimStart), '-to', String(trimEnd), '-i', videoPath]
      : ['-i', videoPath];

  const args = [
    '-y',
    ...videoInputArgs,
    '-filter_complex', filterComplex,
    '-map', '[aout]',
    '-c:a', 'libmp3lame',
    '-b:a', `${mp3Bitrate}k`,
    '-progress', 'pipe:1',
    '-nostats',
    outputPath,
  ];

  return runFfmpegRender(
    args,
    videoInfo.duration,
    onProgress,
    "The audio render failed partway through. This usually means the trim range or normalization settings didn't work together the way ffmpeg expected."
  );
}

/**
 * Encodes a short sample from the middle of the trimmed range at the given CRF and extrapolates
 * a full-length size estimate from the sample's actual encoded size. CRF encoding has no fixed
 * bitrate - how well a video compresses depends entirely on its content (a static talking-head
 * shot vs. a busy, high-motion worship set), so a real sample is the only way to get an estimate
 * that means anything for this specific file, as opposed to a generic guess.
 */
async function estimateVideoSampleSize({ videoPath, sampleStart, sampleSeconds, totalSeconds, width, height, fps, videoCrf }) {
  const tmpPath = path.join(os.tmpdir(), `size-estimate-${crypto.randomUUID()}.mp4`);
  const args = [
    '-y',
    '-ss', String(sampleStart), '-t', String(sampleSeconds), '-i', videoPath,
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p`,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', String(videoCrf),
    '-pix_fmt', 'yuv420p',
    '-an',
    tmpPath,
  ];
  try {
    await run('ffmpeg', args);
    const stat = await fs.promises.stat(tmpPath);
    const bytesPerSecond = stat.size / sampleSeconds;
    return Math.round(bytesPerSecond * totalSeconds);
  } finally {
    fs.promises.rm(tmpPath, { force: true }).catch(() => {});
  }
}



/**
 * Measures how loud the sermon audio actually is, so the decision to normalize can be based on a
 * number rather than a guess about whether this week sounds quieter than last week.
 *
 * Uses `loudnorm`'s analysis pass, which reports the same EBU R128 figures the render itself
 * normalizes against - so what's measured here is exactly what the normalizer would act on. Only
 * the audio is decoded (`-vn`), which is why this is quick even on an hour-long service.
 *
 * Measures the trimmed range, not the whole file: the pre-roll and post-roll a sermon gets topped
 * and tailed with are often music or a silent room, and either would drag the number away from
 * what the published clip will actually sound like.
 */
// Analysis tuning, measured against a 45-minute service on a 4-core machine:
//  - ebur128 reads about 250x realtime, so measuring a clip straight through costs roughly one
//    second per four minutes of audio
//  - a sampled pass costs about the same no matter how long the clip is, because the windows are
//    seeked to directly and everything between them is never decoded
// Measured straight through up to an hour, which is exact and covers essentially every sermon.
// This used to be 15 minutes, back when the check sat beside the render button and had to answer
// while someone waited on it. It now reports into the last step of the form and starts as soon as
// the video lands, so it has the whole time anyone spends naming the file and setting save paths
// to finish in - which buys an exact reading instead of an estimate, and removes the one real
// weakness of sampling: a brief peak falling between windows.
const LOUDNESS_WHOLE_RANGE_MAX_SECONDS = 3600;
// Many short windows rather than a few long ones. Coverage is what catches a one-off loud moment
// (a song, applause, a dropped mic): sampling a 45-minute clip with 12 x 20s windows walked
// straight past a 60-second burst and under-read its peak by 17 dB, while ~100 short windows
// caught it to within 0.3 dB. Total audio measured barely differs; the spacing is what matters.
const LOUDNESS_WINDOW_SECONDS = 8;
const LOUDNESS_SECONDS_PER_WINDOW = 30;
const LOUDNESS_MIN_WINDOWS = 40;
// Past roughly this many, seeking costs more than the extra audio is worth.
const LOUDNESS_MAX_WINDOWS = 120;
// R128's absolute gate. A measurement at or under this means nothing registered at all.
const SILENCE_FLOOR_LUFS = -70;

/**
 * Decides how to measure a clip of this length: `null` to measure it straight through, otherwise
 * the window layout to sample it with. Separated out so the thresholds can be reasoned about (and
 * tested) without running ffmpeg.
 */
function planLoudnessSampling(rangeDuration) {
  if (!(rangeDuration > LOUDNESS_WHOLE_RANGE_MAX_SECONDS)) return null;
  const windows = Math.min(
    LOUDNESS_MAX_WINDOWS,
    Math.max(LOUDNESS_MIN_WINDOWS, Math.round(rangeDuration / LOUDNESS_SECONDS_PER_WINDOW))
  );
  return { windows, windowSeconds: LOUDNESS_WINDOW_SECONDS, coveredSeconds: windows * LOUDNESS_WINDOW_SECONDS };
}

/**
 * Runs ffmpeg keeping only the tail of stderr. ebur128 logs a line per 100ms of audio, so on a
 * long clip the full log is megabytes of text nobody reads - but the summary block this needs is
 * the last thing printed, so only the end is worth holding on to.
 */
function runKeepingStderrTail(args, { tailBytes = 8192, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      return reject(Object.assign(new Error('Measurement cancelled.'), { cancelled: true }));
    }
    const proc = spawn('ffmpeg', args);
    let tail = '';
    let cancelled = false;

    // Measuring a long clip is seconds of real work, and trimming makes whatever is running
    // obsolete the moment it happens. Without this the new measurement queues behind a result
    // that is already known to be wrong, which on a 45-minute service is another ten seconds of
    // waiting for an answer nobody will read.
    const onAbort = () => {
      cancelled = true;
      proc.kill('SIGKILL');
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const cleanup = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
    };

    proc.stdout.on('data', () => {});
    proc.stderr.on('data', (chunk) => {
      tail = (tail + chunk).slice(-tailBytes);
    });
    proc.on('error', (err) => {
      cleanup();
      reject(err.code === 'ENOENT'
        ? new Error('"ffmpeg" was not found on PATH. Install ffmpeg and try again.')
        : err);
    });
    proc.on('close', (code) => {
      cleanup();
      if (cancelled) {
        return reject(Object.assign(new Error('Measurement cancelled.'), { cancelled: true }));
      }
      if (code === 0) return resolve(tail);
      const err = new Error(`ffmpeg reported an error while measuring the audio (exit code ${code}).`);
      err.detail = tail;
      reject(err);
    });
  });
}

/**
 * Measures how loud the sermon audio actually is, so the decision to normalize can be based on a
 * number rather than a guess about whether this week sounds quieter than last week.
 *
 * Uses `ebur128`, which reports the same EBU R128 figures the render normalizes against. It was
 * `loudnorm`'s analysis pass before, which returns identical numbers but takes about three times
 * as long - it is a normalizer being asked to measure, and does a pile of work whose result gets
 * thrown away. Swapping to the measurement filter cut a 45-minute clip from 35s to 11s on its own.
 *
 * Longer clips are then sampled rather than read end to end, which puts the answer a few seconds
 * away whatever the length. Only audio is decoded either way (`-vn`).
 *
 * Measures the trimmed range, not the whole file: the pre-roll and post-roll a sermon gets topped
 * and tailed with are often music or a silent room, and either would drag the number away from
 * what the published clip will actually sound like.
 */
async function analyzeLoudness({ videoPath, trimStart, trimEnd, signal }) {
  const hasRange = trimStart != null && trimEnd != null;
  const rangeStart = hasRange ? trimStart : 0;
  const rangeDuration = hasRange ? trimEnd - trimStart : null;
  const plan = rangeDuration != null ? planLoudnessSampling(rangeDuration) : null;

  let args;
  if (!plan) {
    args = [
      '-nostats', '-hide_banner',
      ...(hasRange ? ['-ss', String(rangeStart), '-to', String(trimEnd)] : []),
      '-i', videoPath,
      '-vn',
      '-af', 'ebur128=peak=true',
      '-f', 'null', '-',
    ];
  } else {
    // One window per equal slice of the clip, taken from the middle of its slice so the very
    // start and very end - the parts most likely to be music or room tone - aren't given more
    // weight than the rest.
    const { windows, windowSeconds } = plan;
    const inputs = [];
    let labels = '';
    for (let i = 0; i < windows; i += 1) {
      const centre = rangeStart + (rangeDuration * (i + 0.5)) / windows;
      const latestStart = rangeStart + rangeDuration - windowSeconds;
      const startAt = Math.max(rangeStart, Math.min(centre - windowSeconds / 2, latestStart));
      inputs.push('-ss', startAt.toFixed(3), '-t', String(windowSeconds), '-i', videoPath);
      labels += `[${i}:a]`;
    }
    args = [
      '-nostats', '-hide_banner',
      ...inputs,
      '-vn',
      // Concatenated into one stream before measuring, so R128's gating is applied across the
      // whole sample at once - averaging separate per-window readings afterwards would not be
      // the same thing, since gating decides what counts relative to the overall level.
      '-filter_complex', `${labels}concat=n=${windows}:v=0:a=1[s];[s]ebur128=peak=true`,
      '-f', 'null', '-',
    ];
  }

  const stderr = await runKeepingStderrTail(args, { signal });

  const summaryAt = stderr.lastIndexOf('Integrated loudness:');
  if (summaryAt === -1) {
    const err = new Error('Could not read a loudness measurement from the audio.');
    err.detail = stderr.slice(-4000);
    throw err;
  }
  const summary = stderr.slice(summaryAt);

  // Digital silence reports as "-inf" rather than a number - a real answer, not a failure, so it
  // is passed through as null for the caller to describe rather than coerced into a nonsense
  // figure.
  const grab = (re) => {
    const match = summary.match(re);
    const n = match ? parseFloat(match[1]) : NaN;
    return Number.isFinite(n) ? n : null;
  };

  // R128 gates everything below -70 LUFS absolute, so that figure means "nothing here was loud
  // enough to count", not a very quiet sermon - ebur128 reports the floor itself rather than the
  // -inf loudnorm used to give back. Reported as no measurement, so it is described as silence
  // instead of turning into a nonsense recommendation to add 56 dB.
  const integratedLufs = grab(/^\s*I:\s+(\S+)\s+LUFS/m);

  return {
    integratedLufs: integratedLufs !== null && integratedLufs > SILENCE_FLOOR_LUFS ? integratedLufs : null,
    loudnessRange: grab(/^\s*LRA:\s+(\S+)\s+LU/m),
    truePeakDb: grab(/Peak:\s+(\S+)\s+dBFS/),
    sampled: plan,
  };
}

// How far from the target counts as worth fixing. Below a listener can't tell; above it is the
// week-to-week drift that makes one sermon noticeably quieter than the last.
const LOUDNESS_CLOSE_ENOUGH_LU = 1;
const LOUDNESS_WORTH_FIXING_LU = 3;
// Anything peaking above this is close enough to full scale that the platforms' own encoding can
// push it into clipping.
const TRUE_PEAK_CEILING_DB = -1;

/**
 * Turns a measurement into a plain-English verdict. Kept next to the measurement, and separate
 * from any wording the page uses, so the thresholds are in one place and testable on their own.
 *
 * Returns a `verdict` of 'silent', 'ok', 'optional' or 'recommended', plus the gain that
 * normalizing would apply - which is the number that actually explains the recommendation.
 */
function recommendNormalization({ integratedLufs, truePeakDb, loudnessRange, sampled }, targetLufs) {
  if (integratedLufs === null) {
    return {
      verdict: 'silent',
      headline: 'No audio to measure',
      gainDb: null,
      reasons: ['No sound was detected in this clip.'],
    };
  }

  const gainDb = Math.round((targetLufs - integratedLufs) * 10) / 10;
  const distance = Math.abs(gainDb);
  const direction = gainDb > 0 ? 'quieter' : 'louder';
  const peaksTooHot = truePeakDb !== null && truePeakDb > TRUE_PEAK_CEILING_DB;
  const reasons = [];

  // Each reason is labelled and states one fact on its own terms, so the list still reads
  // straight when the headline is driven by peaks while the average level is perfectly fine -
  // "Normalizing recommended" above a bare "already on target" line just reads like a
  // contradiction.
  let verdict;
  if (distance <= LOUDNESS_CLOSE_ENOUGH_LU) {
    verdict = 'ok';
    reasons.push(`Level: on target, within ${LOUDNESS_CLOSE_ENOUGH_LU} LU of ${targetLufs} LUFS.`);
  } else if (distance <= LOUDNESS_WORTH_FIXING_LU) {
    verdict = 'optional';
    reasons.push(`Level: ${distance.toFixed(1)} LU ${direction} than the ${targetLufs} LUFS target - a small difference most listeners won't pick up.`);
  } else {
    verdict = 'recommended';
    reasons.push(`Level: ${distance.toFixed(1)} LU ${direction} than the ${targetLufs} LUFS target - enough to stand out next to a normally-levelled sermon.`);
  }

  // Worth fixing on its own whatever the average level is doing: normalizing brings a true-peak
  // ceiling with it, and these are the moments that distort.
  if (peaksTooHot) {
    reasons.push(`Peaks: ${truePeakDb.toFixed(1)} dBTP${sampled ? ' in the sections checked' : ''}, over the ${TRUE_PEAK_CEILING_DB} dBTP ceiling - the loudest moments risk distorting once Vimeo and SoundCloud re-encode it.`);
    if (verdict !== 'recommended') verdict = 'recommended';
  }

  // Spoken word normally sits well under this. A wide range usually means the quiet passages are
  // hard to hear at all, which normalizing evens out less than it might seem - so this is
  // reported for information and never changes the verdict.
  if (loudnessRange !== null && loudnessRange > 15) {
    reasons.push(`Range: ${loudnessRange.toFixed(1)} LU between the quietest and loudest passages, which is wide for speech - worth a listen to the quiet parts.`);
  }

  const headline = verdict === 'ok'
    ? 'Levels look good - no need to normalize'
    : verdict === 'optional'
      ? 'Close to target - normalizing optional'
      : distance <= LOUDNESS_WORTH_FIXING_LU && peaksTooHot
        ? 'Normalizing recommended - peaks are too hot'
        : `Normalizing recommended - this clip is noticeably ${direction}`;

  return { verdict, headline, gainDb, reasons };
}

module.exports = {
  probe,
  render,
  renderAudio,
  checkFfmpegAvailable,
  analyzeLoudness,
  recommendNormalization,
  planLoudnessSampling,
  VIDEO_QUALITY_PRESETS,
};
