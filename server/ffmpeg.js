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

// Vimeo re-transcodes everything you upload anyway, so the codec/CRF choice here mostly
// trades render time for file size (and therefore upload time), not final viewer quality.
// H.265 needs roughly +4 CRF over H.264 for comparable perceived quality at meaningfully
// smaller file sizes, at the cost of much slower software encoding.
const VIDEO_QUALITY_PRESETS = {
  h264: { high: 18, balanced: 22, smaller: 27 },
  h265: { high: 22, balanced: 26, smaller: 30 },
};
const MP3_BITRATE_PRESETS = [128, 192, 320];
const VIDEO_CODEC_NAMES = { h264: 'libx264', h265: 'libx265' };

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
 * combined audio is loudness-normalized (EBU R128 `loudnorm`) before the
 * final fade-out.
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
  needsMp3,
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
    ? `[1:a]aformat=sample_rates=48000:channel_layouts=stereo[mainaSrc]`
    : `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${videoDuration},asetpts=PTS-STARTPTS[mainaSrc]`;

  const audioChain = [mainAudioSource];

  // The MP3 export uses its own copy of the main audio (trimmed to just the
  // clip itself, not the PNG holds), so split off a second copy up front
  // when needed — a filter pad can only feed one downstream consumer.
  const mainaLabel = needsMp3 ? 'maina' : 'mainaSrc';
  if (needsMp3) {
    audioChain.push(`[mainaSrc]asplit=2[maina][mainaMp3]`);
  }

  if (crossfadeAudio) {
    audioChain.push(
      `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${startDuration},asetpts=PTS-STARTPTS[silence1]`,
      `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${endDuration},asetpts=PTS-STARTPTS[silence2]`,
      `[silence1][${mainaLabel}]acrossfade=d=${transition}[xa1]`,
      `[xa1][silence2]acrossfade=d=${transition}[xa2]`
    );
  } else {
    // No blend: silence runs right up to the moment the video transition begins/ends,
    // then hard-cuts to/from the main audio. Segment lengths still sum to totalDuration.
    audioChain.push(
      `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${offset1},asetpts=PTS-STARTPTS[silence1]`,
      `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${endDuration - transition},asetpts=PTS-STARTPTS[silence2]`,
      `[silence1][${mainaLabel}][silence2]concat=n=3:v=0:a=1[xa2]`
    );
  }

  let lastAudioLabel = 'xa2';
  if (normalize) {
    audioChain.push(`[xa2]loudnorm=I=${targetLufs}:TP=-1.5:LRA=11[xa2n]`);
    lastAudioLabel = 'xa2n';
  }
  audioChain.push(`[${lastAudioLabel}]afade=t=out:st=${fadeStart}:d=${fadeOut}[aout]`);

  const audioOutputLabels = ['aout'];

  if (needsMp3) {
    // Just the clip's own audio (no PNG-hold silence), still fading up from
    // silence and back down over `transition` seconds at each end, mirroring
    // the crossfade the picture does — regardless of the full render's
    // audio-crossfade toggle.
    let mp3Label = 'mainaMp3';
    if (normalize) {
      audioChain.push(`[mainaMp3]loudnorm=I=${targetLufs}:TP=-1.5:LRA=11[mainaMp3n]`);
      mp3Label = 'mainaMp3n';
    }
    audioChain.push(
      `[${mp3Label}]afade=t=in:st=0:d=${transition}[mp3faded]`,
      `[mp3faded]afade=t=out:st=${videoDuration - transition}:d=${transition}[aoutMp3]`
    );
    audioOutputLabels.push('aoutMp3');
  }

  return {
    filterComplex: [...videoChain, ...audioChain].join(';'),
    totalDuration,
    audioOutputLabels,
  };
}

/**
 * Kicks off the render. Calls onProgress(fractionComplete) periodically.
 */
function render({
  pngPath,
  videoPath,
  outputPath,
  mp3OutputPath,
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
  videoCodec = 'h264',
  videoCrf = VIDEO_QUALITY_PRESETS.h264.high,
  mp3Bitrate = 192,
  onProgress,
}) {
  const videoCodecName = VIDEO_CODEC_NAMES[videoCodec] || VIDEO_CODEC_NAMES.h264;
  const { filterComplex, totalDuration, audioOutputLabels } = buildFilterGraph({
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
    needsMp3: !!mp3OutputPath,
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
    '-map', `[${audioOutputLabels[0]}]`,
    '-c:v', videoCodecName,
    '-preset', 'medium',
    '-crf', String(videoCrf),
    '-pix_fmt', 'yuv420p',
    // Tags the output as Rec.709 rather than leaving color metadata unspecified - doesn't
    // convert the actual pixel values (most footage is already effectively Rec.709 anyway),
    // just removes the guesswork for Vimeo's transcoder on ingest.
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    ...(videoCodecName === 'libx265' ? ['-tag:v', 'hvc1'] : []), // hvc1 tag = correct QuickTime/Apple/Vimeo playback of HEVC-in-MP4
    '-c:a', 'aac',
    '-b:a', '320k', // matches Vimeo's recommended source-upload audio bitrate
    '-movflags', '+faststart',
    '-progress', 'pipe:1',
    '-nostats',
    outputPath,
  ];

  if (mp3OutputPath) {
    args.push('-map', `[${audioOutputLabels[1]}]`, '-c:a', 'libmp3lame', '-b:a', `${mp3Bitrate}k`, mp3OutputPath);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderrTail = '';

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      const match = text.match(/out_time_ms=(\d+)/) || text.match(/out_time_us=(\d+)/);
      if (match && onProgress) {
        const seconds = Number(match[1]) / 1e6;
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
      if (code === 0) resolve({ totalDuration });
      else {
        const err = new Error(
          "The render failed partway through. This usually means the video file, trim range, or output settings didn't work together the way ffmpeg expected."
        );
        err.detail = stderrTail;
        reject(err);
      }
    });
  });
}

/**
 * Encodes a short sample from the middle of the trimmed range at the given codec/CRF and
 * extrapolates a full-length size estimate from the sample's actual encoded size. CRF encoding
 * has no fixed bitrate - how well a video compresses depends entirely on its content (a static
 * talking-head shot vs. a busy, high-motion worship set), so a real sample is the only way to
 * get an estimate that means anything for this specific file, as opposed to a generic guess.
 */
async function estimateVideoSampleSize({
  videoPath,
  sampleStart,
  sampleSeconds,
  totalSeconds,
  width,
  height,
  fps,
  videoCodec,
  videoCrf,
}) {
  const videoCodecName = VIDEO_CODEC_NAMES[videoCodec] || VIDEO_CODEC_NAMES.h264;
  const tmpPath = path.join(os.tmpdir(), `size-estimate-${crypto.randomUUID()}.mp4`);
  const args = [
    '-y',
    '-ss', String(sampleStart), '-t', String(sampleSeconds), '-i', videoPath,
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p`,
    '-c:v', videoCodecName,
    '-preset', 'medium',
    '-crf', String(videoCrf),
    '-pix_fmt', 'yuv420p',
    ...(videoCodecName === 'libx265' ? ['-tag:v', 'hvc1'] : []),
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
 * Runs estimateVideoSampleSize for every quality preset of the requested codec(s), plus exact
 * arithmetic estimates for each MP3 bitrate preset (no sample needed - CBR MP3 size is just
 * bitrate × duration, unlike CRF video). `mainDurationSeconds` is the trimmed clip length
 * (bookend PNG holds are brief and compress trivially, so they're left out of the estimate).
 *
 * `codec`, if given, only samples that one codec's 3 quality presets instead of both codecs'
 * 6 - the UI only shows one codec's sizes at a time (whichever is selected), so estimating the
 * other one up front is wasted work until the user actually switches to it.
 */
async function estimateFileSizes({ videoPath, trimStart, trimEnd, width, height, fps, mainDurationSeconds, codec }) {
  const sampleSeconds = Math.min(12, Math.max(4, mainDurationSeconds / 4));
  const rangeStart = trimStart != null ? trimStart : 0;
  const rangeEnd = trimEnd != null ? trimEnd : mainDurationSeconds;
  const midpoint = rangeStart + (rangeEnd - rangeStart) / 2;
  const sampleStart = Math.max(rangeStart, Math.min(midpoint - sampleSeconds / 2, rangeEnd - sampleSeconds));

  const codecsToSample = codec && VIDEO_QUALITY_PRESETS[codec] ? [codec] : Object.keys(VIDEO_QUALITY_PRESETS);

  const video = {};
  for (const c of codecsToSample) {
    video[c] = {};
    for (const [quality, crf] of Object.entries(VIDEO_QUALITY_PRESETS[c])) {
      // Sequential, not parallel - concurrent ffmpeg encodes would just compete for the same
      // CPU cores and slow each other down with no net time savings.
      video[c][quality] = await estimateVideoSampleSize({
        videoPath,
        sampleStart,
        sampleSeconds,
        totalSeconds: mainDurationSeconds,
        width,
        height,
        fps,
        videoCodec: c,
        videoCrf: crf,
      });
    }
  }

  const audio = {};
  for (const bitrate of MP3_BITRATE_PRESETS) {
    audio[bitrate] = Math.round(((bitrate * 1000) / 8) * mainDurationSeconds);
  }

  return { video, audio };
}

module.exports = {
  probe,
  render,
  checkFfmpegAvailable,
  estimateFileSizes,
  VIDEO_QUALITY_PRESETS,
  MP3_BITRATE_PRESETS,
};
