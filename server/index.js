require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const jobs = require('./jobs');
const { probe, render, checkFfmpegAvailable } = require('./ffmpeg');
const { extractPcmFloat32, transcribeInChunks, computeSpectralFlatness, CHUNK_SECONDS } = require('./transcribe');
const { findSermonCandidates } = require('./sermonDetect');
const { recordRender, getCalibratedDetectionOptions, getLastRenderSettings } = require('./history');
const vimeo = require('./vimeo');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const OUTPUT_DIR = path.join(ROOT, 'output');
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024 * 1024; // 8GB, generous for full-service-length video files

for (const dir of [UPLOAD_DIR, OUTPUT_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const app = express();
app.use(express.static(path.join(ROOT, 'public')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_DIR, req.jobId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, file.fieldname + path.extname(file.originalname || ''));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'png') {
      if (!/^image\//.test(file.mimetype)) return cb(new Error('The bookend graphic must be an image file (PNG recommended).'));
    }
    if (file.fieldname === 'video') {
      if (!/^video\//.test(file.mimetype)) return cb(new Error('The video file must be a video file.'));
    }
    cb(null, true);
  },
});

function assignJobId(req, res, next) {
  req.jobId = crypto.randomUUID();
  next();
}

function useJobIdFromParams(req, res, next) {
  req.jobId = req.params.jobId;
  next();
}

function sanitizeFilename(name) {
  const cleaned = String(name || 'sermon-final')
    .trim()
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 100);
  return cleaned || 'sermon-final';
}

function toPositiveFloat(value, fallback) {
  const n = parseFloat(value);
  return isFinite(n) && n > 0 ? n : fallback;
}

function toNonNegativeFloat(value, fallback) {
  const n = parseFloat(value);
  return isFinite(n) && n >= 0 ? n : fallback;
}

function toBool(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return value === 'true' || value === '1' || value === 'on';
}

const MIN_LUFS = -20;
const MAX_LUFS = -10;

function toLufs(value, fallback) {
  const n = parseFloat(value);
  if (!isFinite(n)) return fallback;
  return Math.min(Math.max(n, MIN_LUFS), MAX_LUFS);
}

// --- Step 1: upload the source video on its own, ahead of any render settings ---
// Decoupling this lets the (potentially very large, hours-long) file get analyzed
// and trimmed before the user ever touches the PNG/render options.
app.post('/api/upload-video', assignJobId, upload.single('video'), async (req, res) => {
  const jobId = req.jobId;
  const cleanup = () => fs.promises.rm(path.join(UPLOAD_DIR, jobId), { recursive: true, force: true }).catch(() => {});

  try {
    if (!(await checkFfmpegAvailable())) {
      await cleanup();
      return res.status(500).json({ error: 'ffmpeg/ffprobe is not installed on the server. Install ffmpeg and restart the app.' });
    }
    if (!req.file) {
      await cleanup();
      return res.status(400).json({ error: 'A video file is required.' });
    }

    const videoInfo = await probe(req.file.path);
    if (!videoInfo.duration || videoInfo.duration <= 0) {
      await cleanup();
      return res.status(400).json({ error: 'Could not read a duration from the uploaded video file. Is it a valid video?' });
    }

    jobs.create(jobId, {
      status: 'uploaded',
      progress: 1,
      videoPath: req.file.path,
      videoInfo,
    });

    res.json({ jobId, duration: videoInfo.duration, width: videoInfo.width, height: videoInfo.height, hasAudio: videoInfo.hasAudio });
  } catch (err) {
    await cleanup();
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Unexpected server error.' });
  }
});

// --- Step 2 (optional): analyze the uploaded video to suggest a sermon start/end ---
app.post('/api/analyze/:jobId', useJobIdFromParams, async (req, res) => {
  const jobId = req.jobId;
  const job = jobs.get(jobId);
  if (!job || !job.videoPath) {
    return res.status(404).json({ error: 'Upload a video first.' });
  }

  jobs.update(jobId, { status: 'analyzing', progress: 0, error: null, candidates: null });
  res.json({ jobId });

  (async () => {
    const samples = await extractPcmFloat32(job.videoPath);
    // Spectral flatness runs as its own ffmpeg pass over the same audio - independent of
    // transcription, so it runs in parallel rather than adding to the wait.
    const [{ chunks }, flatnessByChunk] = await Promise.all([
      transcribeInChunks(samples, {
        onProgress: (fraction) => jobs.update(jobId, { progress: fraction }),
      }),
      computeSpectralFlatness(job.videoPath, CHUNK_SECONDS).catch(() => []), // non-essential signal; don't fail analysis if it errors
    ]);
    chunks.forEach((chunk, i) => {
      if (flatnessByChunk[i] != null) chunk.flatness = flatnessByChunk[i];
    });

    const withText = chunks.filter((c) => c.text).length;
    const calibrated = getCalibratedDetectionOptions();
    console.log(
      `Analyze ${jobId}: ${chunks.length} chunks total, ${withText} with transcribed text, ` +
        `${chunks.filter((c) => c.flatness != null).length} with a flatness reading. ` +
        `Calibrated options from history: ${JSON.stringify(calibrated)}`
    );

    // Full scoring (with the repetition/flatness discounts) gives the best result, but a
    // real recording can come out quieter/noisier/more repetitive than the synthetic signals
    // this was calibrated against - so if it finds nothing, fall back to progressively looser
    // passes rather than leaving the user with no suggestion at all.
    let candidates = findSermonCandidates(chunks, calibrated);
    if (!candidates.length) {
      console.log(`Analyze ${jobId}: no candidates with full scoring, retrying with repetition/flatness discounts disabled`);
      candidates = findSermonCandidates(chunks, { ...calibrated, skipPenalties: true });
    }
    if (!candidates.length) {
      console.log(`Analyze ${jobId}: still nothing, retrying with a looser speech threshold`);
      // Only carry over the calibrated duration target if it's actually present - explicitly
      // spreading an `undefined` value would overwrite (not fall back to) the built-in default.
      const durationCalibration =
        calibrated.idealMinutes != null
          ? { idealMinutes: calibrated.idealMinutes, scoreSigmaMinutes: calibrated.scoreSigmaMinutes }
          : {};
      candidates = findSermonCandidates(chunks, {
        ...durationCalibration,
        skipPenalties: true,
        minWordsPerMinute: 35,
        maxGapChunks: 4,
        minCandidateMinutes: 3,
      });
    }
    console.log(`Analyze ${jobId}: ${candidates.length} candidate(s) found.`);

    // Kept on the job (not persisted to disk) so a later render for this same job can label
    // real speech-bearing content inside vs. outside the confirmed trim for history.js.
    jobs.update(jobId, { status: 'analyzed', progress: 1, candidates, chunks });
  })().catch((err) => {
    jobs.update(jobId, { status: 'error', error: err.message });
  });
});

// --- Step 3: render, using the already-uploaded (and optionally trimmed) video ---
app.post('/api/render/:jobId', useJobIdFromParams, upload.single('png'), async (req, res) => {
  const jobId = req.jobId;
  const job = jobs.get(jobId);

  const cleanupPng = () => (req.file ? fs.promises.rm(req.file.path, { force: true }).catch(() => {}) : Promise.resolve());
  const cleanupAll = () => fs.promises.rm(path.join(UPLOAD_DIR, jobId), { recursive: true, force: true }).catch(() => {});

  try {
    if (!job || !job.videoPath) {
      await cleanupPng();
      return res.status(404).json({ error: 'Upload a video first (this session may have expired - try re-uploading).' });
    }
    if (!(await checkFfmpegAvailable())) {
      await cleanupPng();
      return res.status(500).json({ error: 'ffmpeg/ffprobe is not installed on the server. Install ffmpeg and restart the app.' });
    }
    if (!req.file) {
      await cleanupPng();
      return res.status(400).json({ error: 'A PNG graphic is required.' });
    }

    const fullDuration = job.videoInfo.duration;
    const trimStart = toNonNegativeFloat(req.body.trimStart, 0);
    const trimEnd = toPositiveFloat(req.body.trimEnd, fullDuration);
    const isTrimmed = trimStart > 0.001 || trimEnd < fullDuration - 0.001;
    if (isTrimmed && trimEnd - trimStart < 1) {
      await cleanupPng();
      return res.status(400).json({ error: 'The trimmed range is too short.' });
    }
    const effectiveDuration = isTrimmed ? trimEnd - trimStart : fullDuration;

    const startDuration = toPositiveFloat(req.body.startDuration, 5);
    const endDuration = toPositiveFloat(req.body.endDuration, 5);
    const transition = toPositiveFloat(req.body.transition, 1);
    const fadeOut = toPositiveFloat(req.body.fadeOut, 1.5);
    const outputName = sanitizeFilename(req.body.outputName);
    const crossfadeAudio = toBool(req.body.crossfadeAudio, true);
    const normalize = toBool(req.body.normalizeAudio, false);
    const targetLufs = toLufs(req.body.targetLufs, -14);
    const exportMp3 = toBool(req.body.exportMp3, false);
    const publishToVimeo = toBool(req.body.publishToVimeo, false) && vimeo.isConfigured();
    const vimeoDescription = String(req.body.vimeoDescription || '').slice(0, 5000);
    // Which configured showcases to actually add it to for this render - defaults to "all of
    // them" (undefined) when the field wasn't sent, e.g. by an older client.
    const vimeoShowcaseIds = req.body.vimeoShowcaseIds !== undefined
      ? String(req.body.vimeoShowcaseIds).split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

    if (transition >= startDuration || transition >= endDuration || transition >= effectiveDuration) {
      await cleanupPng();
      return res.status(400).json({
        error: `The crossfade duration (${transition}s) must be shorter than the start image duration, end image duration, and the (trimmed) video itself.`,
      });
    }

    const totalDuration = startDuration + endDuration + effectiveDuration - 2 * transition;
    if (fadeOut >= totalDuration) {
      await cleanupPng();
      return res.status(400).json({ error: `The fade-to-black duration (${fadeOut}s) is longer than the whole rendered video.` });
    }

    const outputPath = path.join(OUTPUT_DIR, `${jobId}.mp4`);
    const mp3OutputPath = exportMp3 ? path.join(OUTPUT_DIR, `${jobId}.mp3`) : null;
    jobs.update(jobId, {
      status: 'rendering',
      progress: 0,
      error: null,
      outputPath,
      outputName: `${outputName}.mp4`,
      mp3OutputPath,
      mp3OutputName: mp3OutputPath ? `${outputName}.mp3` : null,
      willPublishToVimeo: publishToVimeo,
    });

    res.json({ jobId });

    const renderSettings = { startDuration, endDuration, transition, fadeOut, crossfadeAudio, normalize, targetLufs, exportMp3 };

    render({
      pngPath: req.file.path,
      videoPath: job.videoPath,
      outputPath,
      mp3OutputPath,
      trimStart: isTrimmed ? trimStart : null,
      trimEnd: isTrimmed ? trimEnd : null,
      startDuration,
      endDuration,
      transition,
      fadeOut,
      crossfadeAudio,
      normalize,
      targetLufs,
      videoInfo: { ...job.videoInfo, duration: effectiveDuration },
      onProgress: (fraction) => {
        jobs.update(jobId, { progress: fraction });
      },
    })
      .then(() => {
        jobs.update(jobId, { status: 'done', progress: 1 });
        // A deliberately trimmed range (not the whole file) with chunk data from an earlier
        // analyze is real ground truth: label real speech-bearing content inside the confirmed
        // trim as "sermon" and outside it as "not sermon". A render of the whole video doesn't
        // tell us that - it might just be a full-service render with no isolated sermon - so
        // only the render settings get recorded in that case.
        recordRender({
          trimStart: isTrimmed ? trimStart : null,
          trimEnd: isTrimmed ? trimEnd : null,
          chunks: isTrimmed ? job.chunks : null,
          renderSettings,
        });
        cleanupAll();

        // Publishing was confirmed up front (at the "Render" click), so it runs automatically
        // here with no further approval needed - but only ever when that confirmation actually
        // happened for this specific render.
        if (publishToVimeo) {
          jobs.update(jobId, { status: 'publishing', progress: 0, error: null });
          vimeo
            .uploadAndPublish({
              filePath: outputPath,
              name: outputName,
              description: vimeoDescription,
              showcaseIds: vimeoShowcaseIds,
              onProgress: (fraction) => jobs.update(jobId, { progress: fraction }),
            })
            .then(({ videoUrl, showcaseResults }) => {
              jobs.update(jobId, { status: 'published', progress: 1, vimeoUrl: videoUrl, vimeoShowcaseResults: showcaseResults });
            })
            .catch((err) => {
              jobs.update(jobId, { status: 'publish-error', error: err.message });
            });
        }
      })
      .catch((err) => {
        jobs.update(jobId, { status: 'error', error: err.message });
        cleanupPng();
      });
  } catch (err) {
    await cleanupPng();
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Unexpected server error.' });
    }
  }
});

app.use((err, req, res, next) => {
  // Handles multer errors (bad mimetype, file too large) thrown before the route handler runs.
  if (res.headersSent) return next(err);
  res.status(400).json({ error: err.message || 'Upload failed.' });
});

app.get('/api/progress/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  if (!job) return res.status(404).end();

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  const send = (j) =>
    res.write(
      `data: ${JSON.stringify({
        status: j.status,
        progress: j.progress,
        error: j.error,
        hasMp3: !!j.mp3OutputPath,
        candidates: j.candidates || undefined,
        vimeoUrl: j.vimeoUrl || undefined,
        vimeoShowcaseResults: j.vimeoShowcaseResults || undefined,
      })}\n\n`
    );
  send(job);

  // 'done' isn't terminal when a Vimeo publish was confirmed for this render - the same stream
  // keeps going through 'publishing' to 'published'/'publish-error', which are terminal.
  const terminal = (j) => {
    if (['error', 'analyzed', 'published', 'publish-error'].includes(j.status)) return true;
    if (j.status === 'done') return !j.willPublishToVimeo;
    return false;
  };
  if (terminal(job)) {
    return res.end();
  }

  const onUpdate = (j) => {
    send(j);
    if (terminal(j)) {
      jobs.removeListener(`update:${jobId}`, onUpdate);
      res.end();
    }
  };
  jobs.on(`update:${jobId}`, onUpdate);

  req.on('close', () => jobs.removeListener(`update:${jobId}`, onUpdate));
});

// Served inline (no Content-Disposition: attachment) so the <video>/<audio> preview elements
// can play it in place - some browsers (notably Safari) refuse to play media loaded from a
// URL the server marked as an attachment. The download buttons still save with the right
// file name via the anchor tag's own `download` attribute, entirely client-side.
app.get('/api/download/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'done') return res.status(404).end();
  res.sendFile(job.outputPath);
});

app.get('/api/download/:jobId/mp3', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'done' || !job.mp3OutputPath) return res.status(404).end();
  res.sendFile(job.mp3OutputPath);
});

// Last-used render settings (fade durations, crossfade, normalization, etc.), so the form can
// pre-fill with whatever this install actually tends to use instead of fixed HTML defaults.
app.get('/api/preferences', (req, res) => {
  res.json({ renderSettings: getLastRenderSettings() });
});

// Whether Vimeo publishing is set up at all - the frontend only offers the option when this
// is true, since without a token there's nothing it could do.
app.get('/api/vimeo-status', (req, res) => {
  res.json({ configured: vimeo.isConfigured(), showcaseCount: vimeo.getShowcaseIds().length });
});

// Real showcase names for the configured IDs, so the publish dialog can offer a friendly
// checkbox list instead of raw numbers.
app.get('/api/vimeo-showcases', async (req, res) => {
  if (!vimeo.isConfigured()) return res.json({ showcases: [] });
  try {
    res.json({ showcases: await vimeo.getShowcaseDetails() });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not fetch Vimeo showcases.' });
  }
});

app.listen(PORT, () => {
  console.log(`Sermon Video Editor running at http://localhost:${PORT}`);
});

// Sweep old jobs periodically so disk usage doesn't grow unbounded - this now also
// covers uploaded-but-never-rendered videos, since those can now sit around much
// longer (through analysis + manual review) than the old single-request flow.
const MAX_JOB_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
setInterval(() => {
  const now = Date.now();
  for (const job of jobs.jobs.values()) {
    if (now - job.createdAt > MAX_JOB_AGE_MS) {
      fs.promises.rm(path.join(UPLOAD_DIR, job.id), { recursive: true, force: true }).catch(() => {});
      if (job.outputPath) fs.promises.rm(job.outputPath, { force: true }).catch(() => {});
      if (job.mp3OutputPath) fs.promises.rm(job.mp3OutputPath, { force: true }).catch(() => {});
      jobs.delete(job.id);
    }
  }
}, 30 * 60 * 1000).unref();
