const { Vimeo } = require('@vimeo/vimeo');

/**
 * Thin wrapper around the official Vimeo Node SDK: upload a rendered file, set its title/
 * description, and add it to a fixed set of showcases (Vimeo's API still calls these "albums" -
 * same feature, older name). Configuration is entirely via environment variables (see
 * .env.example) so no credentials ever touch the codebase or get committed.
 */

function isConfigured() {
  return !!process.env.VIMEO_ACCESS_TOKEN;
}

function getShowcaseIds() {
  return (process.env.VIMEO_SHOWCASE_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function getClient() {
  if (!isConfigured()) throw new Error('Vimeo is not configured - set VIMEO_ACCESS_TOKEN in .env.');
  return new Vimeo(null, null, process.env.VIMEO_ACCESS_TOKEN);
}

/**
 * Looks up the real name of each configured showcase, so the UI can offer a friendly checkbox
 * list instead of raw IDs. A showcase whose lookup fails (bad ID, no longer accessible) still
 * shows up - just labeled with the ID and flagged - rather than silently vanishing from the list.
 */
async function getShowcaseDetails() {
  const client = getClient();
  const showcaseIds = getShowcaseIds();
  const results = [];
  for (const id of showcaseIds) {
    try {
      const res = await client.request({ method: 'GET', path: `/albums/${id}` });
      results.push({ id, name: (res.body && res.body.name) || `Showcase ${id}` });
    } catch (err) {
      results.push({ id, name: `Showcase ${id} (not found)`, error: err.message || String(err) });
    }
  }
  return results;
}

/**
 * Uploads `filePath` to Vimeo with the given title/description, then adds it to `showcaseIds`
 * (defaults to every ID in VIMEO_SHOWCASE_IDS if not given - e.g. a caller that never offered a
 * choice). A failure adding to one showcase doesn't abort the others - the result reports
 * per-showcase success/failure so the caller can surface exactly what happened.
 */
async function uploadAndPublish({ filePath, name, description, showcaseIds, onProgress }) {
  const client = getClient();

  const videoUri = await new Promise((resolve, reject) => {
    client.upload(
      filePath,
      { name, description },
      (uri) => resolve(uri),
      (bytesUploaded, bytesTotal) => {
        if (onProgress && bytesTotal > 0) onProgress(bytesUploaded / bytesTotal);
      },
      (err) => reject(new Error(typeof err === 'string' ? err : err.message || 'Vimeo upload failed.'))
    );
  });

  const videoId = videoUri.split('/').pop();
  const videoUrl = `https://vimeo.com/${videoId}`;

  const targetShowcaseIds = showcaseIds || getShowcaseIds();
  const showcaseResults = [];
  for (const showcaseId of targetShowcaseIds) {
    try {
      await client.request({ method: 'PUT', path: `/me/albums/${showcaseId}/videos/${videoId}` });
      showcaseResults.push({ showcaseId, ok: true });
    } catch (err) {
      showcaseResults.push({ showcaseId, ok: false, error: err.message || String(err) });
    }
  }

  return { videoUri, videoUrl, showcaseResults };
}

module.exports = { isConfigured, getShowcaseIds, getShowcaseDetails, uploadAndPublish };
