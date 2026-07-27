const fs = require('fs');
const path = require('path');
const { wordCount, uniqueWordRatio } = require('./sermonDetect');

/**
 * Local, private-to-this-install record of past renders: how long the confirmed sermon
 * actually was, what the surrounding "speech vs. music" audio looked like on both sides of
 * that boundary, and what render settings (fade durations, crossfade, normalization, etc.)
 * got used. Nothing here leaves the machine - it's a JSON file in data/, gitignored.
 *
 * Two things get smarter as this accumulates:
 *  - Detection: idealMinutes/scoreSigmaMinutes and the repetition/flatness thresholds in
 *    sermonDetect.js can be recalibrated from real confirmed examples instead of the
 *    synthetic-signal guesses they ship with.
 *  - Render defaults: the render form can be pre-filled with whatever settings were used last,
 *    instead of fixed HTML defaults, since those are usually "whatever this church likes."
 */

const DATA_DIR = path.join(__dirname, '..', 'data');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');

const MIN_SAMPLES_FOR_CALIBRATION = 3;
const MAX_RENDERS_KEPT = 200; // most recent examples matter most; keeps the file bounded

function loadHistory() {
  try {
    const parsed = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    return Array.isArray(parsed.renders) ? parsed : { renders: [] };
  } catch {
    return { renders: [] };
  }
}

function saveHistory(history) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr) {
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((x) => (x - m) ** 2)));
}

function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}

function summarizeChunks(list) {
  if (!list.length) return null;
  const withFlatness = list.filter((c) => typeof c.flatness === 'number');
  return {
    avgWpm: mean(list.map((c) => (wordCount(c.text) / 30) * 60)), // chunks are ~30s; see transcribe.js CHUNK_SECONDS
    avgFlatness: withFlatness.length ? mean(withFlatness.map((c) => c.flatness)) : null,
    avgUniqueRatio: mean(list.map((c) => uniqueWordRatio(c.text))),
    count: list.length,
  };
}

/**
 * Call after a render actually succeeds. `chunks` (from the analyze step, if it ran for this
 * job) let us label real speech-bearing content inside the confirmed trim as "sermon" and
 * outside it as "not sermon" - actual ground truth, not a guess. If auto-detect was never run
 * (fully manual trim, or no trim), `chunks` is omitted and only the render settings get saved.
 */
function recordRender({ trimStart, trimEnd, chunks, renderSettings }) {
  const history = loadHistory();
  const record = {
    timestamp: new Date().toISOString(),
    renderSettings,
  };

  if (trimStart != null && trimEnd != null) {
    record.sermonDurationSec = trimEnd - trimStart;
  }

  if (chunks && chunks.length && trimStart != null && trimEnd != null) {
    const positive = chunks.filter((c) => c.text && c.start >= trimStart && c.end <= trimEnd);
    const negative = chunks.filter((c) => c.text && (c.end <= trimStart || c.start >= trimEnd));
    record.positive = summarizeChunks(positive);
    record.negative = summarizeChunks(negative);
  }

  history.renders.push(record);
  if (history.renders.length > MAX_RENDERS_KEPT) {
    history.renders = history.renders.slice(-MAX_RENDERS_KEPT);
  }
  saveHistory(history);
}

/**
 * Options to hand to findSermonCandidates(), recalibrated from history where there's enough
 * of it to trust, falling back to sermonDetect.js's own defaults (by simply omitting a key)
 * otherwise. Never returns anything for a signal without MIN_SAMPLES_FOR_CALIBRATION examples -
 * a couple of data points isn't enough to safely override a hand-picked default.
 */
function getCalibratedDetectionOptions() {
  const { renders } = loadHistory();
  const options = {};

  const withDuration = renders.filter((r) => r.sermonDurationSec != null);
  if (withDuration.length >= MIN_SAMPLES_FOR_CALIBRATION) {
    const minutes = withDuration.map((r) => r.sermonDurationSec / 60);
    options.idealMinutes = mean(minutes);
    options.scoreSigmaMinutes = Math.max(stddev(minutes), 5); // floor so a run of near-identical durations doesn't produce an unrealistically narrow window
  }

  const withFeatures = renders.filter((r) => r.positive && r.negative);
  if (withFeatures.length >= MIN_SAMPLES_FOR_CALIBRATION) {
    const posWpm = mean(withFeatures.map((r) => r.positive.avgWpm));
    const negWpm = mean(withFeatures.map((r) => r.negative.avgWpm));
    if (posWpm > negWpm) {
      options.minWordsPerMinute = clamp((posWpm + negWpm) / 2, 30, 100);
    }

    const posRatio = mean(withFeatures.map((r) => r.positive.avgUniqueRatio));
    const negRatio = mean(withFeatures.map((r) => r.negative.avgUniqueRatio));
    if (posRatio > negRatio) {
      options.repetitionRatioThreshold = clamp((posRatio + negRatio) / 2, 0.2, 0.5);
    }

    const withFlatness = withFeatures.filter((r) => r.positive.avgFlatness != null && r.negative.avgFlatness != null);
    if (withFlatness.length >= MIN_SAMPLES_FOR_CALIBRATION) {
      const posFlat = mean(withFlatness.map((r) => r.positive.avgFlatness));
      const negFlat = mean(withFlatness.map((r) => r.negative.avgFlatness));
      if (posFlat > negFlat) {
        options.flatnessMusicThreshold = clamp((posFlat + negFlat) / 2, 0.1, 0.5);
      }
    }
  }

  return options;
}

/** Last-used render settings (fade durations, crossfade, normalization, etc.) to pre-fill the form with. */
function getLastRenderSettings() {
  const { renders } = loadHistory();
  for (let i = renders.length - 1; i >= 0; i--) {
    if (renders[i].renderSettings) return renders[i].renderSettings;
  }
  return null;
}

module.exports = { recordRender, getCalibratedDetectionOptions, getLastRenderSettings, MIN_SAMPLES_FOR_CALIBRATION };
