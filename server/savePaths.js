const fs = require('fs');
const path = require('path');

/**
 * The last video/audio save-folder paths chosen, persisted immediately whenever either changes -
 * independent of whether a render actually completes. This is deliberately separate from
 * history.js's render-settings recall (which only updates after a successful render): picking a
 * folder via the Browse dialog should stick for next time even if you never render this session.
 */

const DATA_DIR = path.join(__dirname, '..', 'data');
const SAVE_PATHS_FILE = path.join(DATA_DIR, 'save-paths.json');

function getSavePaths() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SAVE_PATHS_FILE, 'utf8'));
    return {
      videoSavePath: typeof parsed.videoSavePath === 'string' ? parsed.videoSavePath : '',
      audioSavePath: typeof parsed.audioSavePath === 'string' ? parsed.audioSavePath : '',
    };
  } catch {
    return { videoSavePath: '', audioSavePath: '' };
  }
}

function setSavePaths({ videoSavePath, audioSavePath }) {
  const current = getSavePaths();
  const next = {
    videoSavePath: typeof videoSavePath === 'string' ? videoSavePath : current.videoSavePath,
    audioSavePath: typeof audioSavePath === 'string' ? audioSavePath : current.audioSavePath,
  };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SAVE_PATHS_FILE, JSON.stringify(next, null, 2));
  return next;
}

module.exports = { getSavePaths, setSavePaths };
