const { spawn } = require('child_process');

/**
 * Thin wrappers around the ffmpeg/ffprobe binaries. No fluent-ffmpeg dependency;
 * the filter graph below is intricate enough that building the argv by hand is
 * easier to reason about than a builder API.
 */

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
      else reject(new Error(`${cmd} exited with code ${code}\n${stderr.slice(-4000)}`));
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
 * Audio is built in parallel: silence under the PNG segments, crossfaded the
 * same way, then faded out alongside the picture.
 */
function buildFilterGraph({ width, height, fps, videoDuration, hasAudio, startDuration, endDuration, transition, fadeOut }) {
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

  const audioChain = [
    `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${startDuration},asetpts=PTS-STARTPTS[silence1]`,
    `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${endDuration},asetpts=PTS-STARTPTS[silence2]`,
    mainAudioSource,
    `[silence1][maina]acrossfade=d=${transition}[xa1]`,
    `[xa1][silence2]acrossfade=d=${transition}[xa2]`,
    `[xa2]afade=t=out:st=${fadeStart}:d=${fadeOut}[aout]`,
  ];

  return {
    filterComplex: [...videoChain, ...audioChain].join(';'),
    totalDuration,
  };
}

/**
 * Kicks off the render. Calls onProgress(fractionComplete) periodically.
 */
function render({ pngPath, videoPath, outputPath, startDuration, endDuration, transition, fadeOut, videoInfo, onProgress }) {
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
  });

  const args = [
    '-y',
    '-loop', '1', '-t', String(startDuration), '-i', pngPath,
    '-i', videoPath,
    '-loop', '1', '-t', String(endDuration), '-i', pngPath,
    '-filter_complex', filterComplex,
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    '-progress', 'pipe:1',
    '-nostats',
    outputPath,
  ];

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
      else reject(new Error(`ffmpeg failed (exit ${code}):\n${stderrTail}`));
    });
  });
}

module.exports = { probe, render, checkFfmpegAvailable };
