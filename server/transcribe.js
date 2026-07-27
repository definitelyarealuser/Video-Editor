const { spawn } = require('child_process');

const SAMPLE_RATE = 16000;
const CHUNK_SECONDS = 30; // Whisper's native window size - avoids wasted padding/splitting.

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

  for (let start = 0; start < totalSamples; start += chunkSamples) {
    const end = Math.min(start + chunkSamples, totalSamples);
    const slice = floatArray.subarray(start, end);
    const result = await transcriber(slice);
    const text = (result && result.text) || '';
    chunks.push({
      start: start / SAMPLE_RATE,
      end: end / SAMPLE_RATE,
      text: text.trim(),
    });
    if (onProgress) onProgress(Math.min(end / totalSamples, 1));
  }

  return { chunks, totalDuration };
}

module.exports = { extractPcmFloat32, transcribeInChunks, CHUNK_SECONDS };
