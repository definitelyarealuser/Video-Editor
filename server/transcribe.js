const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const ffmpeg = require('./ffmpeg');

/**
 * Transcribes the sermon on this machine, with Whisper, so a title can be suggested from what was
 * actually preached. Nothing is uploaded and no account is needed: the audio goes from the file on
 * disk into a local whisper.cpp process and the words come back.
 *
 * Transcribing a whole service takes minutes, and the trim handles move constantly while someone is
 * working out where the sermon starts - so this does not transcribe "the trimmed range". It cuts the
 * source file into fixed five-minute windows on an absolute grid and transcribes those, caching each
 * one by the file it came from and its position in it. Nudging a trim handle then re-uses every
 * window it already has and only transcribes whatever came into range, which is usually nothing.
 *
 * Windows that only partly overlap the trimmed range are left out rather than clipped, so the text
 * never includes the pre-roll announcements or the post-service chatter either side of the sermon -
 * a title suggested from "please silence your cell phones" is worse than no suggestion. On a short
 * clip, where that rule would leave nothing at all, the best-overlapping window is used anyway.
 */

const DATA_DIR = path.join(__dirname, '..', 'data');
const WHISPER_DIR = path.join(DATA_DIR, 'whisper');
const MODEL_DIR = path.join(WHISPER_DIR, 'models');
const CACHE_DIR = path.join(DATA_DIR, 'transcripts');

const WINDOW_SECONDS = 300;
// A window has to be mostly inside the trimmed range to be worth transcribing. Set high on purpose:
// the cost of being strict is losing a minute of the sermon's own words at each end, where the cost
// of being generous is feeding the welcome and the announcements into a title suggestion.
const MIN_OVERLAP_FRACTION = 0.75;

const BINARY_NAMES = ['whisper-cli', 'whisper-cpp', 'main'];
const SEARCH_DIRS = [
  WHISPER_DIR,
  path.join(WHISPER_DIR, 'build', 'bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
];
const MODEL_DIRS = [
  MODEL_DIR,
  '/opt/homebrew/share/whisper.cpp/models',
  '/usr/local/share/whisper.cpp/models',
];
// Fastest model that is reliably good enough on clear pulpit audio. Small enough to download in a
// minute or two and to run several times faster than realtime on any recent Mac.
const DEFAULT_MODEL = {
  name: 'ggml-base.en.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
  approxMb: 142,
};
// Preference order when several models are sitting there - accuracy first, since a model someone
// went to the trouble of downloading is one they want used.
const MODEL_PREFERENCE = ['medium.en', 'medium', 'small.en', 'small', 'base.en', 'base', 'tiny.en', 'tiny'];

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function findBinary() {
  if (process.env.WHISPER_CLI) {
    return isExecutable(process.env.WHISPER_CLI) ? process.env.WHISPER_CLI : null;
  }
  for (const dir of SEARCH_DIRS) {
    for (const name of BINARY_NAMES) {
      const candidate = path.join(dir, name);
      if (isExecutable(candidate)) return candidate;
    }
  }
  // Anywhere else it might be on PATH - a manual build, macports, a different package manager.
  for (const name of BINARY_NAMES.slice(0, 2)) {
    const found = spawnSync('which', [name], { encoding: 'utf8' });
    const resolved = String(found.stdout || '').trim();
    if (resolved && isExecutable(resolved)) return resolved;
  }
  return null;
}

function findModel() {
  if (process.env.WHISPER_MODEL) {
    return fs.existsSync(process.env.WHISPER_MODEL) ? process.env.WHISPER_MODEL : null;
  }
  const found = [];
  for (const dir of MODEL_DIRS) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.endsWith('.bin')) found.push(path.join(dir, name));
    }
  }
  if (!found.length) return null;
  const rank = (file) => {
    const index = MODEL_PREFERENCE.findIndex((size) => path.basename(file).includes(size));
    return index === -1 ? MODEL_PREFERENCE.length : index;
  };
  return found.sort((a, b) => rank(a) - rank(b))[0];
}

/**
 * Looked up fresh each time rather than cached: installing Whisper is the one thing a user is
 * likely to do while the app is already open, and nobody should have to restart to be told it
 * worked.
 */
function getStatus() {
  const binary = findBinary();
  const model = findModel();
  if (binary && model) {
    return { available: true, binary, model, modelName: path.basename(model) };
  }
  return {
    available: false,
    binary,
    model,
    needs: !binary && !model ? 'both' : !binary ? 'binary' : 'model',
    reason: !binary && !model
      ? 'Transcription needs Whisper installed on this Mac.'
      : !binary
        ? 'The Whisper program is not installed on this Mac.'
        : 'Whisper is installed but has no language model to work from.',
  };
}

// --- Getting the language model, without anyone having to find a folder ---

// Whisper the program comes from Homebrew; the model it reads is a separate 142 MB file that is
// nobody's idea of a fun manual step, so the app fetches it itself the first time it needs it.
let modelDownload = null;

function downloadModel(url, destination, state, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        if (!redirectsLeft) return reject(new Error('Too many redirects fetching the language model.'));
        return downloadModel(response.headers.location, destination, state, redirectsLeft - 1)
          .then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`The language model download failed (HTTP ${response.statusCode}).`));
      }
      state.totalBytes = parseInt(response.headers['content-length'], 10) || 0;
      const partial = `${destination}.part`;
      const file = fs.createWriteStream(partial);
      response.on('data', (chunk) => { state.receivedBytes += chunk.length; });
      response.on('error', reject);
      file.on('error', reject);
      file.on('finish', () => {
        // Only named as the real model once it is complete, so an interrupted download can never
        // be picked up as a working model - whisper would fail on it in a way nobody could read.
        try {
          fs.renameSync(partial, destination);
          resolve(destination);
        } catch (err) {
          reject(err);
        }
      });
      response.pipe(file);
    }).on('error', (err) => reject(new Error(`Could not reach the language model download: ${err.message}`)));
  });
}

function startModelDownload() {
  if (modelDownload && modelDownload.running) return modelDownload;
  const destination = path.join(MODEL_DIR, DEFAULT_MODEL.name);
  modelDownload = { running: true, receivedBytes: 0, totalBytes: DEFAULT_MODEL.approxMb * 1024 * 1024, error: null };
  const state = modelDownload;
  fs.mkdirSync(MODEL_DIR, { recursive: true });
  downloadModel(DEFAULT_MODEL.url, destination, state)
    .then(() => { state.running = false; })
    .catch((err) => {
      state.running = false;
      state.error = err.message;
      fs.rmSync(`${destination}.part`, { force: true });
    });
  return state;
}

function modelDownloadProgress() {
  if (!modelDownload) return null;
  const { running, receivedBytes, totalBytes, error } = modelDownload;
  return {
    running,
    error,
    percent: totalBytes ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100)) : null,
  };
}

// --- The window grid ---

function windowsForRanges(ranges) {
  const needed = new Map();
  let best = null;
  for (const [start, end] of ranges) {
    if (!(end > start)) continue;
    const firstIndex = Math.floor(start / WINDOW_SECONDS);
    const lastIndex = Math.floor((end - 0.001) / WINDOW_SECONDS);
    for (let index = firstIndex; index <= lastIndex; index += 1) {
      const windowStart = index * WINDOW_SECONDS;
      const overlap = Math.min(end, windowStart + WINDOW_SECONDS) - Math.max(start, windowStart);
      if (overlap >= WINDOW_SECONDS * MIN_OVERLAP_FRACTION) needed.set(index, true);
      if (!best || overlap > best.overlap) best = { index, overlap };
    }
  }
  // Too short for any whole window - transcribe the one with the most of the sermon in it.
  if (!needed.size && best) needed.set(best.index, true);
  return [...needed.keys()].sort((a, b) => a - b);
}

// --- Per-file transcript store ---

/**
 * Identifies the source file by path, size and modification time, so re-uploading a different
 * service can never be served another one's words, while re-opening the same file picks up every
 * window already transcribed.
 */
function fileKey(videoPath) {
  const stat = fs.statSync(videoPath);
  return crypto.createHash('sha1')
    .update(`${path.resolve(videoPath)}:${stat.size}:${Math.round(stat.mtimeMs)}`)
    .digest('hex')
    .slice(0, 16);
}

function cachePath(key, index) {
  return path.join(CACHE_DIR, key, `${String(index).padStart(4, '0')}.txt`);
}

function readCachedWindow(key, index) {
  try {
    return fs.readFileSync(cachePath(key, index), 'utf8');
  } catch {
    return null;
  }
}

function writeCachedWindow(key, index, text) {
  const file = cachePath(key, index);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// One job per source file. Whisper is CPU-bound and this app may be rendering at the same time, so
// windows are transcribed one at a time, in order, and the queue is simply re-pointed when the trim
// changes rather than restarted.
const jobs = new Map();

function jobFor(key) {
  if (!jobs.has(key)) {
    jobs.set(key, { key, queue: [], running: false, text: new Map(), error: null });
  }
  return jobs.get(key);
}

function runWhisper({ binary, model, wavPath, threads }) {
  return new Promise((resolve, reject) => {
    const outBase = wavPath.replace(/\.wav$/, '');
    const args = [
      '-m', model,
      '-f', wavPath,
      '-l', 'en',
      '-t', String(threads),
      '-nt', // no timestamps - this is for reading, not subtitling
      '-np', // no progress prints
      '-otxt',
      '-of', outBase,
    ];
    const proc = spawn(binary, args);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        const err = new Error(`Whisper exited with code ${code}.`);
        err.detail = stderr;
        return reject(err);
      }
      let text = '';
      try {
        text = fs.readFileSync(`${outBase}.txt`, 'utf8');
      } catch {
        // Older builds write the text to stdout instead of a file.
        text = stdout;
      }
      fs.rmSync(`${outBase}.txt`, { force: true });
      resolve(text.trim());
    });
  });
}

function threadCount() {
  // Leaves a couple of cores for the render and for the machine to stay usable, which matters
  // because this runs while someone is still working in the app.
  return Math.max(2, Math.min(8, (os.cpus() || []).length - 2 || 2));
}

async function transcribeWindow(job, videoPath, index) {
  const status = getStatus();
  if (!status.available) throw new Error(status.reason);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sermon-stt-'));
  const wavPath = path.join(dir, 'window.wav');
  try {
    await ffmpeg.extractSpeechWav({
      videoPath,
      start: index * WINDOW_SECONDS,
      duration: WINDOW_SECONDS,
      outPath: wavPath,
    });
    const text = await runWhisper({
      binary: status.binary,
      model: status.model,
      wavPath,
      threads: threadCount(),
    });
    writeCachedWindow(job.key, index, text);
    job.text.set(index, text);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function drain(job, videoPath) {
  if (job.running) return;
  job.running = true;
  try {
    while (job.queue.length) {
      const index = job.queue.shift();
      if (job.text.has(index)) continue;
      const cached = readCachedWindow(job.key, index);
      if (cached !== null) {
        job.text.set(index, cached);
        continue;
      }
      try {
        await transcribeWindow(job, videoPath, index);
        job.error = null;
      } catch (err) {
        // A window that fails is almost always a setup problem that will fail for every other
        // window too, so stop rather than grinding through eight of them.
        job.error = err.message;
        job.queue.length = 0;
        break;
      }
    }
  } finally {
    job.running = false;
  }
}

/**
 * Makes sure the words for this trimmed range are either in hand or on their way, and reports where
 * things stand. Safe and cheap to call repeatedly - the client polls it while the user trims.
 */
function requestTranscript({ videoPath, ranges }) {
  const status = getStatus();
  // Whisper installed but no model: that is the app's job to fix, not the user's. Fetch it in the
  // background and report the download as the progress, since that is what is actually happening.
  if (!status.available && status.needs === 'model') {
    const download = startModelDownload();
    if (download.error) {
      return {
        available: false,
        needs: 'model',
        reason: `Could not download the language model: ${download.error}`,
        windowsDone: 0,
        windowsTotal: 0,
      };
    }
    return {
      available: false,
      needs: 'model',
      downloadingModel: true,
      modelPercent: modelDownloadProgress().percent,
      reason: 'Downloading the language model Whisper needs - this happens once.',
      windowsDone: 0,
      windowsTotal: 0,
    };
  }
  if (!status.available) {
    return {
      available: false,
      needs: status.needs,
      reason: status.reason,
      windowsDone: 0,
      windowsTotal: 0,
    };
  }

  const key = fileKey(videoPath);
  const job = jobFor(key);
  const needed = windowsForRanges(ranges);

  const missing = [];
  for (const index of needed) {
    if (job.text.has(index)) continue;
    const cached = readCachedWindow(key, index);
    if (cached !== null) job.text.set(index, cached);
    else missing.push(index);
  }

  // Re-point the queue at what is wanted now. Whatever window is mid-flight keeps going: it is
  // already paid for and it stays cached either way.
  job.queue = missing;
  if (missing.length) drain(job, videoPath);

  const done = needed.filter((index) => job.text.has(index));
  const text = done.map((index) => job.text.get(index)).join('\n').trim();
  return {
    available: true,
    modelName: status.modelName,
    windowsTotal: needed.length,
    windowsDone: done.length,
    minutesTranscribed: Math.round((done.length * WINDOW_SECONDS) / 60),
    working: job.running || job.queue.length > 0,
    error: job.error,
    text,
  };
}

/** Throws away cached words for a file, for when its upload is being cleaned up. */
function forget(videoPath) {
  let key;
  try {
    key = fileKey(videoPath);
  } catch {
    // The file is already gone, so there is no key to look up - nothing to do but leave the
    // cached text for forgetAll() below, which is what actually runs in that case.
    return;
  }
  jobs.delete(key);
  fs.rmSync(path.join(CACHE_DIR, key), { recursive: true, force: true });
}

/**
 * Drops every cached transcript. Called when the app shuts down and clears uploads/: an uploaded
 * video that is gone can never be matched to its words again (the cache is keyed to the file), so
 * keeping them would only leave text from old services lying about.
 */
function forgetAll() {
  jobs.clear();
  fs.rmSync(CACHE_DIR, { recursive: true, force: true });
}

module.exports = {
  getStatus,
  requestTranscript,
  modelDownloadProgress,
  forget,
  forgetAll,
  windowsForRanges,
  WINDOW_SECONDS,
  MODEL_DIR,
  DEFAULT_MODEL,
};
