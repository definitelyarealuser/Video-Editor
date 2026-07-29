const fs = require('fs');
const path = require('path');

/**
 * Local, private-to-this-install record of past renders' settings (fade durations, crossfade,
 * normalization, etc.), so the render form can be pre-filled with whatever this install
 * actually tends to use instead of fixed HTML defaults. Nothing here leaves the machine - it's
 * a JSON file in data/, gitignored.
 */

const DATA_DIR = path.join(__dirname, '..', 'data');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');

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

/** Call after a render actually succeeds. */
function recordRender({ renderSettings }) {
  const history = loadHistory();
  history.renders.push({ timestamp: new Date().toISOString(), renderSettings });
  if (history.renders.length > MAX_RENDERS_KEPT) {
    history.renders = history.renders.slice(-MAX_RENDERS_KEPT);
  }
  saveHistory(history);
}

/** Last-used render settings (fade durations, crossfade, normalization, etc.) to pre-fill the form with. */
function getLastRenderSettings() {
  const { renders } = loadHistory();
  for (let i = renders.length - 1; i >= 0; i--) {
    if (renders[i].renderSettings) return renders[i].renderSettings;
  }
  return null;
}

module.exports = { recordRender, getLastRenderSettings };
