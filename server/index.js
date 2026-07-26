const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const jobs = require('./jobs');
const { probe, render, checkFfmpegAvailable } = require('./ffmpeg');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const OUTPUT_DIR = path.join(ROOT, 'output');
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024 * 1024; // 8GB, generous for sermon-length video files

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
      if (!/^video\//.test(file.mimetype)) return cb(new Error('The sermon file must be a video file.'));
    }
    cb(null, true);
  },
});

function assignJobId(req, res, next) {
  req.jobId = crypto.randomUUID();
  next();
}

function sanitizeFilename(name) {
  const cleaned = String(name || 'sermon-final')
    .trim()
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 100);
  return cleaned || 'sermon-final';
}

function toPositiveFloat(value, fallback) {
  const n = parseFloat(value);
  return isFinite(n) && n > 0 ? n : fallback;
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

app.post(
  '/api/render',
  assignJobId,
  upload.fields([{ name: 'video', maxCount: 1 }, { name: 'png', maxCount: 1 }]),
  async (req, res) => {
    const jobId = req.jobId;

    const cleanupUpload = () => fs.promises.rm(path.join(UPLOAD_DIR, jobId), { recursive: true, force: true }).catch(() => {});

    try {
      if (!(await checkFfmpegAvailable())) {
        await cleanupUpload();
        return res.status(500).json({ error: 'ffmpeg/ffprobe is not installed on the server. Install ffmpeg and restart the app.' });
      }

      const videoFile = req.files && req.files.video && req.files.video[0];
      const pngFile = req.files && req.files.png && req.files.png[0];
      if (!videoFile || !pngFile) {
        await cleanupUpload();
        return res.status(400).json({ error: 'Both a video file and a PNG graphic are required.' });
      }

      const startDuration = toPositiveFloat(req.body.startDuration, 5);
      const endDuration = toPositiveFloat(req.body.endDuration, 5);
      const transition = toPositiveFloat(req.body.transition, 1);
      const fadeOut = toPositiveFloat(req.body.fadeOut, 1.5);
      const outputName = sanitizeFilename(req.body.outputName);
      const crossfadeAudio = toBool(req.body.crossfadeAudio, true);
      const normalize = toBool(req.body.normalizeAudio, false);
      const targetLufs = toLufs(req.body.targetLufs, -14);
      const exportMp3 = toBool(req.body.exportMp3, false);

      const videoInfo = await probe(videoFile.path);
      if (!videoInfo.duration || videoInfo.duration <= 0) {
        await cleanupUpload();
        return res.status(400).json({ error: 'Could not read a duration from the uploaded video file. Is it a valid video?' });
      }

      if (transition >= startDuration || transition >= endDuration || transition >= videoInfo.duration) {
        await cleanupUpload();
        return res.status(400).json({
          error: `The crossfade duration (${transition}s) must be shorter than the start image duration, end image duration, and the video itself.`,
        });
      }

      const totalDuration = startDuration + endDuration + videoInfo.duration - 2 * transition;
      if (fadeOut >= totalDuration) {
        await cleanupUpload();
        return res.status(400).json({ error: `The fade-to-black duration (${fadeOut}s) is longer than the whole rendered video.` });
      }

      const outputPath = path.join(OUTPUT_DIR, `${jobId}.mp4`);
      const mp3OutputPath = exportMp3 ? path.join(OUTPUT_DIR, `${jobId}.mp3`) : null;
      jobs.create(jobId, {
        status: 'rendering',
        progress: 0,
        outputPath,
        outputName: `${outputName}.mp4`,
        mp3OutputPath,
        mp3OutputName: mp3OutputPath ? `${outputName}.mp3` : null,
      });

      res.json({ jobId });

      render({
        pngPath: pngFile.path,
        videoPath: videoFile.path,
        outputPath,
        mp3OutputPath,
        startDuration,
        endDuration,
        transition,
        fadeOut,
        crossfadeAudio,
        normalize,
        targetLufs,
        videoInfo,
        onProgress: (fraction) => {
          jobs.update(jobId, { progress: fraction });
        },
      })
        .then(() => {
          jobs.update(jobId, { status: 'done', progress: 1 });
          cleanupUpload();
        })
        .catch((err) => {
          jobs.update(jobId, { status: 'error', error: err.message });
          cleanupUpload();
        });
    } catch (err) {
      await cleanupUpload();
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Unexpected server error.' });
      }
    }
  }
);

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
      `data: ${JSON.stringify({ status: j.status, progress: j.progress, error: j.error, hasMp3: !!j.mp3OutputPath })}\n\n`
    );
  send(job);

  if (job.status === 'done' || job.status === 'error') {
    return res.end();
  }

  const onUpdate = (j) => {
    send(j);
    if (j.status === 'done' || j.status === 'error') {
      jobs.removeListener(`update:${jobId}`, onUpdate);
      res.end();
    }
  };
  jobs.on(`update:${jobId}`, onUpdate);

  req.on('close', () => jobs.removeListener(`update:${jobId}`, onUpdate));
});

app.get('/api/download/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'done') return res.status(404).end();
  res.download(job.outputPath, job.outputName);
});

app.get('/api/download/:jobId/mp3', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'done' || !job.mp3OutputPath) return res.status(404).end();
  res.download(job.mp3OutputPath, job.mp3OutputName);
});

app.listen(PORT, () => {
  console.log(`Sermon Video Editor running at http://localhost:${PORT}`);
});

// Sweep old finished/failed output files periodically so disk usage doesn't grow unbounded.
const MAX_JOB_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
setInterval(() => {
  const now = Date.now();
  for (const job of jobs.jobs.values()) {
    if (now - job.createdAt > MAX_JOB_AGE_MS) {
      if (job.outputPath) fs.promises.rm(job.outputPath, { force: true }).catch(() => {});
      if (job.mp3OutputPath) fs.promises.rm(job.mp3OutputPath, { force: true }).catch(() => {});
      jobs.delete(job.id);
    }
  }
}, 30 * 60 * 1000).unref();
