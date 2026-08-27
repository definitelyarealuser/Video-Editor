const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');

/**
 * A small local library of previously-used images (bookend graphics, square SoundCloud artwork,
 * etc.), so a repeat one can be picked from a list instead of uploaded again every time. Nothing
 * here leaves the machine - a JSON index plus the image files themselves, both gitignored under
 * data/, same as history.js.
 *
 * One call to this factory = one independent library: its own index file and image folder,
 * named after `kind` (e.g. 'bookend' -> data/bookend-images.json + data/bookend-images/). Used
 * to give the bookend graphic and the square SoundCloud artwork their own separate libraries
 * without duplicating this logic - see bookendImages.js and squareArtImages.js.
 */
function createImageLibrary(kind) {
  const IMAGES_DIR = path.join(DATA_DIR, `${kind}-images`);
  const INDEX_PATH = path.join(DATA_DIR, `${kind}-images.json`);

  function loadIndex() {
    try {
      const parsed = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
      return Array.isArray(parsed.images) ? parsed.images : [];
    } catch {
      return [];
    }
  }

  function saveIndex(images) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(INDEX_PATH, JSON.stringify({ images }, null, 2));
  }

  function hashFile(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  }

  /**
   * Copies `sourcePath` into the library, deduping by content hash - re-uploading the same
   * graphic (which happens a lot, since a church tends to reuse a handful of graphics) doesn't
   * pile up duplicate entries, it just bumps the existing one's lastUsedAt.
   */
  function saveImage({ sourcePath, originalName, mimetype }) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    const images = loadIndex();
    const hash = hashFile(sourcePath);
    const existing = images.find((img) => img.hash === hash);
    if (existing) {
      existing.lastUsedAt = new Date().toISOString();
      saveIndex(images);
      return existing;
    }

    const id = crypto.randomUUID();
    const ext = path.extname(originalName || '') || '.png';
    const storedFilename = `${id}${ext}`;
    fs.copyFileSync(sourcePath, path.join(IMAGES_DIR, storedFilename));

    const now = new Date().toISOString();
    const entry = {
      id,
      name: originalName || storedFilename,
      storedFilename,
      mimetype: mimetype || 'image/png',
      hash,
      uploadedAt: now,
      lastUsedAt: now,
    };
    images.push(entry);
    saveIndex(images);
    return entry;
  }

  function listImages() {
    return loadIndex()
      .slice()
      .sort((a, b) => new Date(b.lastUsedAt) - new Date(a.lastUsedAt));
  }

  function getImage(id) {
    return loadIndex().find((img) => img.id === id) || null;
  }

  // Marks a library image as just used, without re-copying it - so picking the same one from
  // the list repeatedly still floats it to the top like a fresh upload would.
  function touchImage(id) {
    const images = loadIndex();
    const entry = images.find((img) => img.id === id);
    if (!entry) return;
    entry.lastUsedAt = new Date().toISOString();
    saveIndex(images);
  }

  function deleteImage(id) {
    const images = loadIndex();
    const idx = images.findIndex((img) => img.id === id);
    if (idx === -1) return false;
    const [entry] = images.splice(idx, 1);
    saveIndex(images);
    fs.promises.rm(path.join(IMAGES_DIR, entry.storedFilename), { force: true }).catch(() => {});
    return true;
  }

  return { IMAGES_DIR, saveImage, listImages, getImage, touchImage, deleteImage };
}

module.exports = createImageLibrary;
