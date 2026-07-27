const { spawn } = require('child_process');

const SAMPLE_RATE = 16000;
const CHUNK_SECONDS = 30; // Whisper's native window size - avoids wasted padding/splitting.

// Chunks quieter than this are skipped entirely (no transcription call, text stays empty).
// -40 dBFS is well below normal speech/singing levels but above typical room-noise floor, so it
// only catches true silence/dead air, not quiet music. This both saves inference time (skipped
// chunks are common in a worship set with instrumental breaks and transition silence) and avoids
// a known Whisper failure mode: it sometimes hallucinates text - repeated phrases, stock
// training-data artifacts - when fed near-silent audio with no real signal to anchor on, which
// would otherwise corrupt the word-density signal the sermon detector relies on.
const SILENCE_DBFS_THRESHOLD = -40;

function chunkRmsDbfs(samples) {
  if (!samples.length) return -Infinity;
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSquares += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

/**
 * Runs ffmpeg's spectral-flatness analysis once over the whole audio track and averages the
 * result into the same fixed-size chunk windows used for transcription. Low flatness = tonal/
 * harmonic content (sustained notes, chords); high flatness = noise-like/broadband (consonants,
 * unvoiced speech sounds). One ffmpeg pass, no per-chunk subprocess spawns, runs in parallel
 * with transcription since the two don't depend on each other.
 */
function computeSpectralFlatness(videoPath, chunkSeconds = CHUNK_SECONDS) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', videoPath,
      '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE),
      '-af', 'aspectralstats=measure=flatness,ametadata=print:key=lavfi.aspectralstats.1.flatness',
      '-f', 'null', '-',
    ];
    const proc = spawn('ffmpeg', args);
    let stderrBuf = '';

    proc.stderr.on('data', (d) => {
      stderrBuf += d.toString();
    });
    proc.on('error', (err) => {
      if (err.code === 'ENOENT') reject(new Error('ffmpeg was not found on PATH.'));
      else reject(err);
    });
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Spectral analysis failed (exit ${code}):\n${stderrBuf.slice(-2000)}`));
      resolve(bucketFlatnessByChunk(stderrBuf, chunkSeconds));
    });
  });
}

function bucketFlatnessByChunk(stderrText, chunkSeconds) {
  const frameTimeRe = /pts_time:([\d.]+)/;
  const flatnessRe = /flatness=([\d.]+)/;
  const sums = [];
  const counts = [];
  let pendingTime = null;

  for (const line of stderrText.split('\n')) {
    const frameMatch = line.match(frameTimeRe);
    if (frameMatch) {
      pendingTime = parseFloat(frameMatch[1]);
      continue;
    }
    const flatnessMatch = line.match(flatnessRe);
    if (flatnessMatch && pendingTime !== null) {
      const idx = Math.floor(pendingTime / chunkSeconds);
      sums[idx] = (sums[idx] || 0) + parseFloat(flatnessMatch[1]);
      counts[idx] = (counts[idx] || 0) + 1;
      pendingTime = null;
    }
  }

  return sums.map((sum, i) => (counts[i] ? sum / counts[i] : null));
}

/**
 * Decodes the audio track of a video into a mono 16kHz Float32Array via ffmpeg,
 * entirely in memory. Whisper (through @huggingface/transformers) wants raw
 * float samples in Node - there's no AudioContext to lean on outside a browser.
 */
function extractPcmFloat32(videoPath) {
  return new Promise((resolve, reject) => {
    const args = ['-i', videoPath, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', '-'];
    const proc = spawn('ffmpeg', args);
    const chunks = [];
    let stderrTail = '';

    proc.stdout.on('data', (d) => chunks.push(d));
    proc.stderr.on('data', (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-2000);
    });
    proc.on('error', (err) => {
      if (err.code === 'ENOENT') reject(new Error('ffmpeg was not found on PATH.'));
      else reject(err);
    });
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Audio extraction failed (exit ${code}):\n${stderrTail}`));
      const buf = Buffer.concat(chunks);
      // ArrayBuffer.slice always returns a fresh, 0-offset buffer, so the Float32Array view is safely aligned.
      const aligned = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length - (buf.length % 4));
      resolve(new Float32Array(aligned));
    });
  });
}

let transcriberPromise = null;
function getTranscriber() {
  if (!transcriberPromise) {
    const { pipeline } = require('@huggingface/transformers');
    transcriberPromise = pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en').catch((err) => {
      transcriberPromise = null; // allow retrying on a later request instead of caching a permanent failure
      throw new Error(
        `Could not load the speech-recognition model (downloaded once, then cached locally): ${err.message}`
      );
    });
  }
  return transcriberPromise;
}

/**
 * Transcribes audio in fixed 30s windows (Whisper's native chunk size, so nothing
 * is wasted on internal padding/splitting). Precision doesn't need to be word-level -
 * this only has to be good enough to tell "someone talking" from "music" apart in
 * ~30s buckets, so per-chunk word counts are enough. Reports progress in [0,1].
 */
async function transcribeInChunks(floatArray, { onProgress } = {}) {
  const transcriber = await getTranscriber();
  const totalSamples = floatArray.length;
  const chunkSamples = CHUNK_SECONDS * SAMPLE_RATE;
  const totalDuration = totalSamples / SAMPLE_RATE;
  const chunks = [];
  let skippedCount = 0;
  let totalCount = 0;

  for (let start = 0; start < totalSamples; start += chunkSamples) {
    const end = Math.min(start + chunkSamples, totalSamples);
    const slice = floatArray.subarray(start, end);
    totalCount++;

    let text = '';
    if (chunkRmsDbfs(slice) > SILENCE_DBFS_THRESHOLD) {
      const result = await transcriber(slice);
      text = ((result && result.text) || '').trim();
    } else {
      skippedCount++;
    }

    chunks.push({ start: start / SAMPLE_RATE, end: end / SAMPLE_RATE, text });
    if (onProgress) onProgress(Math.min(end / totalSamples, 1));
  }

  if (skippedCount > 0) {
    console.log(`Transcription: skipped ${skippedCount}/${totalCount} silent chunks (below ${SILENCE_DBFS_THRESHOLD} dBFS)`);
  }

  return { chunks, totalDuration };
}

module.exports = { extractPcmFloat32, transcribeInChunks, computeSpectralFlatness, CHUNK_SECONDS };
