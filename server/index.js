require('dotenv').config();

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const jobs = require('./jobs');
const { probe, render, renderAudio, checkFfmpegAvailable, estimateFileSizes, VIDEO_QUALITY_PRESETS, MP3_BITRATE_PRESETS } = require('./ffmpeg');
const { recordRender, getLastRenderSettings } = require('./history');
const vimeo = require('./vimeo');
const soundcloud = require('./soundcloud');
const bookendImages = require('./bookendImages');
const squareArtImages = require('./squareArtImages');
const savePaths = require('./savePaths');
const nativeFolderPicker = require('./nativeFolderPicker');
const gitUpdate = require('./gitUpdate');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const OUTPUT_DIR = path.join(ROOT, 'output');

for (const dir of [UPLOAD_DIR, OUTPUT_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const app = express();
app.use(express.static(path.join(ROOT, 'public')));
app.use('/bookend-images', express.static(bookendImages.IMAGES_DIR));
app.use('/square-art-images', express.static(squareArtImages.IMAGES_DIR));
app.use(express.json());

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
  // No fileSize limit - multer defaults to Infinity when this is omitted. The only real ceiling
  // left is disk space on whatever machine is running the app (uploads/ and output/ both hold
  // full-size files, if briefly), not anything this app enforces itself.
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'png') {
      if (!/^image\//.test(file.mimetype)) return cb(new Error('The bookend graphic must be an image file (PNG recommended).'));
    }
    // Shared by both image libraries' own upload routes, so it can't name a specific graphic.
    if (file.fieldname === 'image') {
      if (!/^image\//.test(file.mimetype)) return cb(new Error('That file must be an image (PNG recommended).'));
    }
    if (file.fieldname === 'squareArt') {
      if (!/^image\//.test(file.mimetype)) return cb(new Error('The square SoundCloud graphic must be an image file (PNG recommended).'));
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

// Copies a rendered file into a user-specified local folder (this app only ever runs on the
// same machine as the browser using it, so a plain filesystem path from the form is meaningful
// here - not a remote/multi-tenant path). Creates the folder if it doesn't exist yet. Never
// throws - a failure here shouldn't take down an otherwise-successful render, it just gets
// reported back to the browser alongside the normal download links.
async function copyToFolder(sourcePath, folderPath, filename) {
  if (!folderPath) return {};
  try {
    await fs.promises.mkdir(folderPath, { recursive: true });
    const destPath = path.join(folderPath, filename);
    await fs.promises.copyFile(sourcePath, destPath);
    return { savedTo: destPath };
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

// Resolves the requested trim range against the video's actual length. Clamping matters because
// every downstream duration (the xfade offsets, the fade-to-black start, the progress bar's
// denominator) is derived from trimEnd - trimStart: a trimEnd past the real end doesn't fail,
// it just silently builds a timeline longer than the material, so the end crossfade and
// fade-to-black land past where the video stops and never happen. The UI's slider is already
// bounded by the real duration, so this only ever fires on a malformed/stale request.
function resolveTrimRange(rawStart, rawEnd, fullDuration) {
  const start = Math.min(Math.max(toNonNegativeFloat(rawStart, 0), 0), fullDuration);
  const end = Math.min(toPositiveFloat(rawEnd, fullDuration), fullDuration);
  return { trimStart: start, trimEnd: end };
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
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Unexpected server error.', errorDetail: err.detail });
  }
});

const renderUpload = upload.fields([
  { name: 'png', maxCount: 1 },
  { name: 'squareArt', maxCount: 1 },
]);

// --- Step 2: render, using the already-uploaded (and optionally trimmed) video ---
app.post('/api/render/:jobId', useJobIdFromParams, renderUpload, async (req, res) => {
  const jobId = req.jobId;
  const job = jobs.get(jobId);

  const pngFile = req.files && req.files.png ? req.files.png[0] : null;
  const squareArtFile = req.files && req.files.squareArt ? req.files.squareArt[0] : null;
  const cleanupUploadedExtras = () =>
    Promise.all(
      [pngFile, squareArtFile]
        .filter(Boolean)
        .map((f) => fs.promises.rm(f.path, { force: true }).catch(() => {}))
    );

  try {
    if (!job || !job.videoPath) {
      await cleanupUploadedExtras();
      return res.status(404).json({ error: 'Upload a video first (this session may have expired - try re-uploading).' });
    }
    if (!(await checkFfmpegAvailable())) {
      await cleanupUploadedExtras();
      return res.status(500).json({ error: 'ffmpeg/ffprobe is not installed on the server. Install ffmpeg and restart the app.' });
    }
    let pngPath = pngFile ? pngFile.path : null;
    if (!pngPath && req.body.pngImageId) {
      const libraryImage = bookendImages.getImage(req.body.pngImageId);
      if (libraryImage) pngPath = path.join(bookendImages.IMAGES_DIR, libraryImage.storedFilename);
    }
    if (!pngPath) {
      await cleanupUploadedExtras();
      return res.status(400).json({ error: 'A bookend graphic is required.' });
    }

    let squareArtPath = squareArtFile ? squareArtFile.path : null;
    if (!squareArtPath && req.body.squareArtImageId) {
      const libraryImage = squareArtImages.getImage(req.body.squareArtImageId);
      if (libraryImage) squareArtPath = path.join(squareArtImages.IMAGES_DIR, libraryImage.storedFilename);
    }
    if (!squareArtPath) {
      await cleanupUploadedExtras();
      return res.status(400).json({ error: 'A square SoundCloud graphic is required.' });
    }

    // Whichever way each graphic arrived, make sure it's in its own library so it can be picked
    // again next time without re-uploading - saveImage/touchImage both dedupe/no-op safely if
    // it's already there (e.g. the client's own background save-on-drop already handled it).
    if (pngFile) {
      try {
        bookendImages.saveImage({ sourcePath: pngFile.path, originalName: pngFile.originalname, mimetype: pngFile.mimetype });
      } catch {
        // Non-critical - rendering itself doesn't depend on the library save succeeding.
      }
    } else if (req.body.pngImageId) {
      bookendImages.touchImage(req.body.pngImageId);
    }
    if (squareArtFile) {
      try {
        squareArtImages.saveImage({ sourcePath: squareArtFile.path, originalName: squareArtFile.originalname, mimetype: squareArtFile.mimetype });
      } catch {
        // Non-critical - rendering itself doesn't depend on the library save succeeding.
      }
    } else if (req.body.squareArtImageId) {
      squareArtImages.touchImage(req.body.squareArtImageId);
    }

    const fullDuration = job.videoInfo.duration;
    const { trimStart, trimEnd } = resolveTrimRange(req.body.trimStart, req.body.trimEnd, fullDuration);
    const isTrimmed = trimStart > 0.001 || trimEnd < fullDuration - 0.001;
    if (trimEnd - trimStart < 1) {
      await cleanupUploadedExtras();
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
    const videoQuality = Object.prototype.hasOwnProperty.call(VIDEO_QUALITY_PRESETS, req.body.videoQuality)
      ? req.body.videoQuality
      : 'high';
    const videoCrf = VIDEO_QUALITY_PRESETS[videoQuality];
    const mp3Bitrate = MP3_BITRATE_PRESETS.includes(Number(req.body.mp3Bitrate)) ? Number(req.body.mp3Bitrate) : 192;
    const publishToVimeo = toBool(req.body.publishToVimeo, false) && vimeo.isConnected();
    const vimeoDescription = String(req.body.vimeoDescription || '').slice(0, 5000);
    // Which configured showcases to actually add it to for this render - defaults to "all of
    // them" (undefined) when the field wasn't sent, e.g. by an older client.
    const vimeoShowcaseIds = req.body.vimeoShowcaseIds !== undefined
      ? String(req.body.vimeoShowcaseIds).split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    const vimeoPrivacy = String(req.body.vimeoPrivacy || 'anybody');
    const publishToSoundCloud = toBool(req.body.publishToSoundCloud, false) && exportMp3 && soundcloud.isConnected();
    const soundcloudPlaylistIds = req.body.soundcloudPlaylistIds !== undefined
      ? String(req.body.soundcloudPlaylistIds).split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    const soundcloudPrivacy = String(req.body.soundcloudPrivacy || 'private');
    // Optional local folders (on this same machine, since the server runs on your own computer)
    // to also copy the finished file(s) into, on top of whatever Vimeo/SoundCloud publishing was
    // requested - copyToFolder() below is already a no-op when either is blank, so there's
    // nothing to validate here beyond just trimming them.
    const videoSavePath = String(req.body.videoSavePath || '').trim();
    const audioSavePath = String(req.body.audioSavePath || '').trim();

    if (transition >= startDuration || transition >= endDuration || transition >= effectiveDuration) {
      await cleanupUploadedExtras();
      return res.status(400).json({
        error: `The crossfade duration (${transition}s) must be shorter than the start image duration, end image duration, and the (trimmed) video itself.`,
      });
    }

    const totalDuration = startDuration + endDuration + effectiveDuration - 2 * transition;
    if (fadeOut >= totalDuration) {
      await cleanupUploadedExtras();
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
      mp3Status: mp3OutputPath ? 'rendering' : null,
      mp3Progress: 0,
      willPublishToVimeo: publishToVimeo,
      willPublishToSoundcloud: publishToSoundCloud,
    });

    res.json({ jobId });

    const renderSettings = {
      startDuration,
      endDuration,
      transition,
      fadeOut,
      crossfadeAudio,
      normalize,
      targetLufs,
      exportMp3,
      videoSavePath,
      audioSavePath,
      videoQuality,
      mp3Bitrate,
    };

    (async () => {
      // The MP3, if requested, renders first - it's just the clip's own audio (no PNG, no
      // libx264 encode), so it finishes dramatically faster than the video and can be saved
      // and published to SoundCloud while the video render is still going, instead of both
      // outputs only becoming available together at the very end.
      if (mp3OutputPath) {
        try {
          await renderAudio({
            videoPath: job.videoPath,
            outputPath: mp3OutputPath,
            trimStart: isTrimmed ? trimStart : null,
            trimEnd: isTrimmed ? trimEnd : null,
            transition,
            normalize,
            targetLufs,
            mp3Bitrate,
            videoInfo: { ...job.videoInfo, duration: effectiveDuration },
            onProgress: (fraction) => jobs.update(jobId, { mp3Progress: fraction }),
          });
          const audioSaveResult = await copyToFolder(mp3OutputPath, audioSavePath, `${outputName}.mp3`);
          jobs.update(jobId, {
            mp3Status: 'done',
            mp3Progress: 1,
            audioSavedTo: audioSaveResult.savedTo || null,
            audioSaveError: audioSaveResult.error || null,
          });

          // Runs independently of (and in parallel with) the video render and Vimeo publish
          // below - a SoundCloud failure shouldn't block or be blocked by either, and vice versa.
          if (publishToSoundCloud) {
            jobs.update(jobId, { scStatus: 'publishing', scProgress: 0, scError: null });
            soundcloud
              .uploadAndPublish({
                filePath: mp3OutputPath,
                title: outputName,
                description: vimeoDescription, // same Core Text, sent to both platforms
                privacy: soundcloudPrivacy,
                playlistIds: soundcloudPlaylistIds,
                artworkPath: squareArtPath,
                onProgress: (fraction) => jobs.update(jobId, { scProgress: fraction }),
              })
              .then(({ trackUrl, playlistResults }) => {
                jobs.update(jobId, { scStatus: 'published', scProgress: 1, scUrl: trackUrl, scPlaylistResults: playlistResults });
              })
              .catch((err) => {
                jobs.update(jobId, { scStatus: 'error', scError: err.message });
              });
          }
        } catch (err) {
          // An MP3 failure is reported but doesn't abort the render - the video is still the
          // main deliverable, and a failed audio pass shouldn't waste an otherwise-good video.
          jobs.update(jobId, {
            mp3Status: 'error',
            mp3Progress: 1,
            mp3Error: err.message,
            mp3ErrorDetail: err.detail || null,
          });
        }
      }

      await render({
        pngPath,
        videoCrf,
        videoPath: job.videoPath,
        outputPath,
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
      });

      const videoSaveResult = await copyToFolder(outputPath, videoSavePath, `${outputName}.mp4`);
      jobs.update(jobId, {
        status: 'done',
        progress: 1,
        videoSavedTo: videoSaveResult.savedTo || null,
        videoSaveError: videoSaveResult.error || null,
      });
      recordRender({ renderSettings });
      // The uploaded source video is deliberately never deleted right after a render (success
      // or failure) - Re-Edit on the client can jump back into trimming this same job's video
      // without a re-upload, as long as it does so before the periodic sweep below reclaims it
      // (2 hours after upload, same as everything else).

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
            privacy: vimeoPrivacy,
            thumbnailPath: pngPath,
            onProgress: (fraction) => jobs.update(jobId, { progress: fraction }),
          })
          .then(({ videoUrl, showcaseResults, thumbnailError }) => {
            jobs.update(jobId, {
              status: 'published',
              progress: 1,
              vimeoUrl: videoUrl,
              vimeoShowcaseResults: showcaseResults,
              vimeoThumbnailError: thumbnailError,
            });
          })
          .catch((err) => {
            jobs.update(jobId, { status: 'publish-error', error: err.message });
          });
      }
    })().catch((err) => {
      jobs.update(jobId, { status: 'error', error: err.message, errorDetail: err.detail || null });
      cleanupUploadedExtras();
    });
  } catch (err) {
    await cleanupUploadedExtras();
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Unexpected server error.', errorDetail: err.detail });
    }
  }
});

// Estimates output file sizes for every video quality/codec combo and MP3 bitrate, by actually
// encoding a short sample from the middle of the (possibly trimmed) selection and extrapolating -
// CRF encoding has no fixed bitrate, so a real sample is the only way this means anything for
// the specific file being rendered. Can take a while (up to 6 short encodes); that's expected.
app.post('/api/estimate-size/:jobId', useJobIdFromParams, async (req, res) => {
  const job = jobs.get(req.jobId);
  if (!job || !job.videoPath) {
    return res.status(404).json({ error: 'Upload a video first (this session may have expired - try re-uploading).' });
  }
  if (!(await checkFfmpegAvailable())) {
    return res.status(500).json({ error: 'ffmpeg/ffprobe is not installed on the server. Install ffmpeg and restart the app.' });
  }

  const fullDuration = job.videoInfo.duration;
  const { trimStart, trimEnd } = resolveTrimRange(req.body.trimStart, req.body.trimEnd, fullDuration);
  const mainDurationSeconds = Math.max(trimEnd - trimStart, 1);

  try {
    const sizes = await estimateFileSizes({
      videoPath: job.videoPath,
      trimStart,
      trimEnd,
      width: job.videoInfo.width,
      height: job.videoInfo.height,
      fps: job.videoInfo.fps,
      mainDurationSeconds,
    });
    res.json(sizes);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not estimate file sizes.', errorDetail: err.detail });
  }
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

  // 'done' isn't terminal when a Vimeo and/or SoundCloud publish was confirmed for this render -
  // the stream keeps going until whichever of those were requested each reach their own terminal
  // state (Vimeo via `status`, SoundCloud via the separate `scStatus` since they run in parallel
  // and independently of each other).
  const vimeoSettled = (j) => !j.willPublishToVimeo || j.status === 'published' || j.status === 'publish-error';
  const soundcloudSettled = (j) => !j.willPublishToSoundcloud || j.scStatus === 'published' || j.scStatus === 'error';
  const terminal = (j) => {
    // A failed video render still lets an already-started SoundCloud publish finish reporting -
    // the MP3 renders (and uploads) first and is entirely independent of the video pass, so
    // closing the stream the instant the video fails would drop a publish still in flight.
    if (j.status === 'error') return soundcloudSettled(j);
    if (!['done', 'publishing', 'published', 'publish-error'].includes(j.status)) return false;
    return vimeoSettled(j) && soundcloudSettled(j);
  };

  const send = (j) =>
    res.write(
      `data: ${JSON.stringify({
        // Whether this is the last frame on this stream. The client closes on it rather than
        // re-deriving "are we finished?" from the individual statuses: the two used to be
        // computed independently on each side, and any disagreement left the client holding a
        // stream the server had already ended - which EventSource then silently reconnects to
        // every few seconds, forever, with the UI stuck mid-render.
        streamDone: terminal(j),
        status: j.status,
        progress: j.progress,
        error: j.error,
        errorDetail: j.errorDetail || undefined,
        hasMp3: !!j.mp3OutputPath,
        mp3Status: j.mp3Status || undefined,
        mp3Progress: j.mp3Progress,
        mp3Error: j.mp3Error || undefined,
        mp3ErrorDetail: j.mp3ErrorDetail || undefined,
        vimeoUrl: j.vimeoUrl || undefined,
        vimeoShowcaseResults: j.vimeoShowcaseResults || undefined,
        vimeoThumbnailError: j.vimeoThumbnailError || undefined,
        scStatus: j.scStatus || undefined,
        scProgress: j.scProgress,
        scError: j.scError || undefined,
        scUrl: j.scUrl || undefined,
        scPlaylistResults: j.scPlaylistResults || undefined,
        videoSavedTo: j.videoSavedTo || undefined,
        videoSaveError: j.videoSaveError || undefined,
        audioSavedTo: j.audioSavedTo || undefined,
        audioSaveError: j.audioSaveError || undefined,
      })}\n\n`
    );
  send(job);
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
// The video file itself is fully written and safe to serve as soon as status reaches 'done' -
// everything after that ('publishing'/'published'/'publish-error') is just the optional Vimeo
// step running on top of an already-finished file, so all of those still count as downloadable
// (only 'rendering', still in progress, and 'error', a failed render, don't). This matters more
// now that local save is optional - download is often the only way to get the file at all, and
// needs to keep working for as long as the result page is showing it, not just the instant the
// video first finishes.
const DOWNLOADABLE_STATUSES = ['done', 'publishing', 'published', 'publish-error'];

app.get('/api/download/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || !DOWNLOADABLE_STATUSES.includes(job.status)) return res.status(404).end();
  res.sendFile(job.outputPath);
});

app.get('/api/download/:jobId/mp3', (req, res) => {
  const job = jobs.get(req.params.jobId);
  // Checks mp3Status specifically, not the overall job status - the MP3 finishes well before
  // the video does, and should be downloadable as soon as it's ready rather than waiting on it.
  if (!job || job.mp3Status !== 'done' || !job.mp3OutputPath) return res.status(404).end();
  res.sendFile(job.mp3OutputPath);
});

function toClientImage(entry, urlPrefix) {
  return { id: entry.id, name: entry.name, url: `${urlPrefix}/${entry.storedFilename}`, uploadedAt: entry.uploadedAt };
}

// The bookend image library: saved automatically whenever a PNG is dropped in (see
// /api/render below too, as a fallback), so past graphics can be reused without re-uploading.
app.post('/api/bookend-images', assignJobId, upload.single('image'), async (req, res) => {
  const cleanup = () => fs.promises.rm(path.join(UPLOAD_DIR, req.jobId), { recursive: true, force: true }).catch(() => {});
  if (!req.file) {
    await cleanup();
    return res.status(400).json({ error: 'No image provided.' });
  }
  try {
    const entry = bookendImages.saveImage({
      sourcePath: req.file.path,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
    });
    res.json({ image: toClientImage(entry, '/bookend-images') });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to save image.' });
  } finally {
    await cleanup();
  }
});

app.get('/api/bookend-images', (req, res) => {
  res.json({ images: bookendImages.listImages().map((entry) => toClientImage(entry, '/bookend-images')) });
});

app.delete('/api/bookend-images/:id', (req, res) => {
  const ok = bookendImages.deleteImage(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found.' });
  res.json({ ok: true });
});

// The square SoundCloud artwork library - same shape as the bookend image library above, kept
// entirely separate (own index file, own image folder) since the two are unrelated images.
app.post('/api/square-art-images', assignJobId, upload.single('image'), async (req, res) => {
  const cleanup = () => fs.promises.rm(path.join(UPLOAD_DIR, req.jobId), { recursive: true, force: true }).catch(() => {});
  if (!req.file) {
    await cleanup();
    return res.status(400).json({ error: 'No image provided.' });
  }
  try {
    const entry = squareArtImages.saveImage({
      sourcePath: req.file.path,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
    });
    res.json({ image: toClientImage(entry, '/square-art-images') });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to save image.' });
  } finally {
    await cleanup();
  }
});

app.get('/api/square-art-images', (req, res) => {
  res.json({ images: squareArtImages.listImages().map((entry) => toClientImage(entry, '/square-art-images')) });
});

app.delete('/api/square-art-images/:id', (req, res) => {
  const ok = squareArtImages.deleteImage(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found.' });
  res.json({ ok: true });
});

// Lists subfolders of a directory on this machine, for the "Browse…" folder pickers next to
// the video/audio save-path fields. Only meaningful because this app always runs on the same
// computer as the browser using it - same trust model as the save-path copy feature itself,
// which already allows writing to any local path the user types in directly.
app.get('/api/browse-folders', async (req, res) => {
  const targetPath = path.resolve(req.query.path ? String(req.query.path) : os.homedir());
  try {
    const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
    const folders = entries
      .filter((e) => e.isDirectory())
      .map((e) => ({ name: e.name, path: path.join(targetPath, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const parent = path.dirname(targetPath);
    res.json({ path: targetPath, parent: parent !== targetPath ? parent : null, folders });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Could not read that folder.' });
  }
});

// Whether this OS supports popping the real native folder picker (Windows/Mac) - the frontend
// uses this to decide whether to try that first, falling back to the in-app browser above.
app.get('/api/browse-folders/supported', (req, res) => {
  res.json({ supported: nativeFolderPicker.isSupported() });
});

// Opens the OS's own folder picker dialog and waits for the user to choose or cancel - this
// request just blocks until that happens, which is expected (it's a modal dialog).
app.get('/api/browse-folders/native', async (req, res) => {
  if (!nativeFolderPicker.isSupported()) {
    return res.status(501).json({ error: 'Native folder picker is not supported on this platform.' });
  }
  try {
    const selectedPath = await nativeFolderPicker.pickFolder(req.query.path ? String(req.query.path) : undefined);
    res.json({ path: selectedPath }); // null means the user cancelled the dialog
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not open the folder picker.' });
  }
});

// Last-used render settings (fade durations, crossfade, normalization, etc.), so the form can
// pre-fill with whatever this install actually tends to use instead of fixed HTML defaults.
app.get('/api/preferences', (req, res) => {
  res.json({ renderSettings: getLastRenderSettings() });
});

// The video/audio save-folder paths, remembered the moment either is chosen or typed - not
// tied to actually completing a render, unlike the render-settings recall above.
app.get('/api/save-paths', (req, res) => {
  res.json(savePaths.getSavePaths());
});

app.post('/api/save-paths', (req, res) => {
  res.json(savePaths.setSavePaths(req.body || {}));
});

// Whether Vimeo publishing has a legacy token or an OAuth app's client id/secret set up, and is
// connected (a usable access token actually exists) - these are separate because setting up an
// OAuth app doesn't mean Connect Vimeo has actually been clicked yet, same distinction as
// SoundCloud's status below.
app.get('/api/vimeo-status', (req, res) => {
  res.json({
    connected: vimeo.isConnected(),
    hasOAuthApp: vimeo.hasOAuthApp(),
    showcaseCount: vimeo.getShowcaseIds().length,
  });
});

// The Vimeo setup panel's own state - whether a Client Identifier/Secret have been saved
// (without ever sending the secret itself back down), so the form can show "already saved"
// instead of blank fields, and explain when env vars are in charge instead.
app.get('/api/vimeo-app-config', (req, res) => {
  res.json(vimeo.getAppConfigStatus());
});

// Saves the Client Identifier/Secret entered in the app's own setup panel - the whole point of
// this endpoint is that a non-technical user never has to find, open, or edit .env for this.
app.post('/api/vimeo-app-config', (req, res) => {
  try {
    const { clientId, clientSecret } = req.body || {};
    const showcaseIds = req.body && req.body.showcaseIds !== undefined
      ? String(req.body.showcaseIds).split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    vimeo.saveAppConfig({ clientId, clientSecret, showcaseIds });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Could not save Vimeo settings.' });
  }
});

// Full reset - clears the saved Client Identifier/Secret AND any connected account token, so
// someone can switch Vimeo accounts or start over after entering the wrong values.
app.delete('/api/vimeo-app-config', (req, res) => {
  vimeo.clearAppConfig();
  res.json({ ok: true });
});

// Signs out of the connected Vimeo account without clearing the Client Identifier/Secret -
// works regardless of whether those came from the saved file or env vars, so Connect Vimeo can
// be redone (e.g. to test the connect flow, or switch which Vimeo account is linked) without
// re-entering app credentials. A legacy VIMEO_ACCESS_TOKEN needs an actual restart to take
// effect (env vars are only read once, at startup) - same exit(42) restart-on-launch's own
// update mechanism uses, so start.command's wrapping loop picks it back up automatically.
app.post('/api/vimeo/disconnect', (req, res) => {
  const { restartNeeded } = vimeo.disconnect();
  res.json({ ok: true, restarting: restartNeeded });
  if (restartNeeded) {
    setTimeout(() => process.exit(42), 500);
  }
});

// Real showcase names for the configured IDs, so the publish dialog can offer a friendly
// checkbox list instead of raw numbers.
app.get('/api/vimeo-showcases', async (req, res) => {
  if (!vimeo.isConnected()) return res.json({ showcases: [] });
  try {
    res.json({ showcases: await vimeo.getShowcaseDetails() });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not fetch Vimeo showcases.' });
  }
});

// Full-page redirect (not fetched) - mirrors /api/soundcloud/connect below. Only meaningful
// when an OAuth app (VIMEO_CLIENT_ID/VIMEO_CLIENT_SECRET) is set up - a legacy VIMEO_ACCESS_TOKEN
// is already connected with nothing further to do, so the frontend never offers this button then.
app.get('/api/vimeo/connect', (req, res) => {
  try {
    res.redirect(vimeo.getAuthorizeUrl());
  } catch (err) {
    res.status(400).send(err.message || 'Vimeo OAuth is not configured.');
  }
});

app.get('/api/vimeo/oauth-callback', async (req, res) => {
  try {
    const { code, state, error, error_description: errorDescription } = req.query;
    if (error) throw new Error(errorDescription || error);
    await vimeo.handleOAuthCallback(code, state);
    res.redirect('/?vimeo=connected');
  } catch (err) {
    res.redirect(`/?vimeo=error&message=${encodeURIComponent(err.message || 'Connection failed.')}`);
  }
});

// Whether SoundCloud publishing has an OAuth app's client id/secret saved (from the saved file
// or env vars) and is connected (a usable refresh token actually exists) - these are separate
// because setting up an OAuth app doesn't mean Connect SoundCloud has actually been clicked yet.
// Unlike Vimeo, there's no legacy-token case, so hasOAuthApp is the only "is this set up" flag.
app.get('/api/soundcloud-status', (req, res) => {
  res.json({
    connected: soundcloud.isConnected(),
    hasOAuthApp: soundcloud.hasOAuthApp(),
    playlistCount: soundcloud.getPlaylistIds().length,
  });
});

// Real playlist names for the configured IDs, so the publish dialog can offer a friendly
// checkbox list instead of raw numbers - mirrors /api/vimeo-showcases.
app.get('/api/soundcloud-playlists', async (req, res) => {
  if (!soundcloud.isConnected()) return res.json({ playlists: [] });
  try {
    res.json({ playlists: await soundcloud.getPlaylistDetails() });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not fetch SoundCloud playlists.' });
  }
});

app.get('/api/soundcloud-resolve-playlist', async (req, res) => {
  if (!soundcloud.isConnected()) {
    return res.status(400).json({ error: 'Connect to SoundCloud first, then playlist URLs can be looked up automatically.' });
  }
  try {
    res.json(await soundcloud.resolvePlaylistUrl(req.query.url));
  } catch (err) {
    res.status(400).json({ error: err.message || 'Could not resolve that playlist URL.' });
  }
});

// The SoundCloud setup panel's own state - whether a Client ID/Secret have been saved (without
// ever sending the secret itself back down), so the form can show "already saved" instead of
// blank fields, and explain when env vars are in charge instead. Mirrors /api/vimeo-app-config.
app.get('/api/soundcloud-app-config', (req, res) => {
  res.json(soundcloud.getAppConfigStatus());
});

// Saves the Client ID/Secret entered in the app's own setup panel - same point as Vimeo's
// equivalent: nobody has to find, open, or edit .env for this.
app.post('/api/soundcloud-app-config', (req, res) => {
  try {
    const { clientId, clientSecret } = req.body || {};
    const playlistIds = req.body && req.body.playlistIds !== undefined
      ? String(req.body.playlistIds).split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    soundcloud.saveAppConfig({ clientId, clientSecret, playlistIds });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Could not save SoundCloud settings.' });
  }
});

// Full reset - clears the saved Client ID/Secret AND any connected account token, so someone
// can switch SoundCloud accounts or start over after entering the wrong values.
app.delete('/api/soundcloud-app-config', (req, res) => {
  soundcloud.clearAppConfig();
  res.json({ ok: true });
});

// Signs out of the connected SoundCloud account without clearing the Client ID/Secret - works
// regardless of whether those came from the saved file or env vars, so Connect SoundCloud can
// be redone without re-entering app credentials. Unlike Vimeo, there's no legacy-token restart
// case here - SoundCloud is always OAuth, so a plain token clear is always enough.
app.post('/api/soundcloud/disconnect', (req, res) => {
  soundcloud.disconnect();
  res.json({ ok: true });
});

// Full-page redirect (not fetched) - SoundCloud needs the browser itself to navigate there so
// the FF account can log in and approve access, then it bounces back to oauth-callback below.
app.get('/api/soundcloud/connect', (req, res) => {
  try {
    res.redirect(soundcloud.getAuthorizeUrl());
  } catch (err) {
    res.status(400).send(err.message || 'SoundCloud OAuth is not configured.');
  }
});

app.get('/api/soundcloud/oauth-callback', async (req, res) => {
  try {
    const { code, state, error, error_description: errorDescription } = req.query;
    if (error) throw new Error(errorDescription || error);
    await soundcloud.handleOAuthCallback(code, state);
    res.redirect('/?soundcloud=connected');
  } catch (err) {
    res.redirect(`/?soundcloud=error&message=${encodeURIComponent(err.message || 'Connection failed.')}`);
  }
});

// Current commit info, for the "Up to date (abc1234 - ...)" status line - cheap, no network
// call, safe to hit on every page load unlike the check/apply routes below.
app.get('/api/update/status', async (req, res) => {
  try {
    const [branch, current] = await Promise.all([gitUpdate.getCurrentBranch(), gitUpdate.getCurrentCommit()]);
    res.json({ branch, current });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not read the current version.' });
  }
});

// Error handler for anything thrown before/inside a route handler that isn't caught there -
// most importantly multer's own rejections (bad mimetype), which happen in middleware before
// the route body ever runs. MUST stay below every route: Express only routes errors to an error
// handler registered after the route that raised them, so when this sat mid-file the image
// library uploads below it fell through to Express's default handler and answered with an HTML
// page containing a stack trace and absolute paths, instead of the JSON the client expects.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  res.status(400).json({ error: err.message || 'Upload failed.' });
});

// Checks GitHub for a newer commit on this branch and, if one exists, pulls it down and
// restarts before ever binding the port - fully automatic, no button/API call needed. The
// process exits with a specific code (42) that start.command's wrapping loop recognizes as
// "restart me" (as opposed to any other exit meaning the app actually stopped); the relaunch
// then re-runs this same check, finds nothing new, and proceeds to actually listen. A failed
// check or apply (no network, dirty working tree, npm failure, etc.) must never block startup -
// it just falls through and starts with whatever code is already on disk.
async function checkAndApplyUpdateThenListen() {
  try {
    const result = await gitUpdate.checkForUpdate();
    if (result.updateAvailable) {
      console.log(`Update available: "${result.latest.message}" (currently on "${result.current.message}") - applying...`);
      await gitUpdate.applyUpdate();
      console.log('Update applied - restarting to load the new code...');
      process.exit(42);
      return;
    }
    console.log(`Up to date (${result.current.hash.slice(0, 7)} - "${result.current.message}").`);
  } catch (err) {
    console.log(`Skipping update check (${err.message}) - starting with the code already on disk.`);
  }

  app.listen(PORT, () => {
    console.log(`Sermon Video Editor running at http://localhost:${PORT}`);
  });
}

checkAndApplyUpdateThenListen();

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

// Clears uploads/ (raw source videos/images for renders) the moment the app actually stops,
// rather than waiting on the sweep above - a closed session shouldn't leave large files sitting
// on disk until the next 2-hour-plus sweep gets to them. Deliberately NOT hooked into the
// auto-update restart above (process.exit(42) calls) - that's this same process intentionally
// exiting to relaunch itself with new code moments later, not a real stop, and an in-progress
// Re-Edit needs its uploaded video to survive that. Only fires on an actual termination signal:
// Ctrl+C (SIGINT), a kill/SIGTERM, or the Terminal window itself closing (SIGHUP).
async function cleanupUploadsAndExit(signal) {
  console.log(`\nReceived ${signal} - clearing uploads/ before exiting...`);
  try {
    // Clears the folder's contents, not the folder itself - UPLOAD_DIR also holds .gitkeep
    // (tracked so the empty directory survives a fresh checkout), and deleting a tracked file
    // would make git see a dirty working tree, which is exactly what the auto-update check
    // above refuses to update over. Only the per-job subfolders (and any other real upload) are
    // fair game here.
    const entries = await fs.promises.readdir(UPLOAD_DIR);
    await Promise.all(
      entries
        .filter((name) => name !== '.gitkeep')
        .map((name) => fs.promises.rm(path.join(UPLOAD_DIR, name), { recursive: true, force: true }))
    );
  } catch {
    // Non-critical - the app is exiting either way.
  }
  process.exit(0);
}
['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((signal) => {
  process.on(signal, () => cleanupUploadsAndExit(signal));
});
