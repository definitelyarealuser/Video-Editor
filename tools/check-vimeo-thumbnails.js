#!/usr/bin/env node
/**
 * Lists recent Vimeo videos and says, for each, whether its thumbnail is the graphic that was
 * uploaded with it or a frame Vimeo picked by itself.
 *
 * Custom thumbnails were broken until 2026-09-06 - the app looked for the upload link under the
 * wrong field, so every one failed and Vimeo fell back to its own frame. This answers "which of
 * our videos are affected" in one go, rather than opening each one to look.
 *
 * It also counts spare thumbnails. Vimeo keeps every picture ever attached to a video and offers
 * all of them in its thumbnail picker, so a video usually carries the uploaded graphic alongside
 * the frame Vimeo generated for itself - near-identical here, since these videos open on that
 * very graphic. Only one is ever wanted.
 *
 * Run from the app's folder:   node tools/check-vimeo-thumbnails.js
 * Optionally pass how many to check (default 25, max 100):
 *                              node tools/check-vimeo-thumbnails.js 50
 * Add --tidy to delete the spares, keeping each video's active thumbnail:
 *                              node tools/check-vimeo-thumbnails.js 50 --tidy
 *
 * Without --tidy it only reads: it fetches metadata and changes nothing. With --tidy it deletes
 * only non-active pictures, and only on videos whose active thumbnail is an uploaded one - so it
 * can never leave a video without the picture it is currently showing.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Vimeo } = require('@vimeo/vimeo');

const DATA_DIR = path.join(__dirname, '..', 'data');
// The date the thumbnail fix landed - anything published before it never had a real chance.
const FIX_DATE = '2026-09-06';

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
  } catch {
    return null;
  }
}

function buildClient() {
  const config = readJson('vimeo-app-config.json') || {};
  const clientId = process.env.VIMEO_CLIENT_ID || config.clientId;
  const clientSecret = process.env.VIMEO_CLIENT_SECRET || config.clientSecret;
  const accessToken = process.env.VIMEO_ACCESS_TOKEN || (readJson('vimeo-tokens.json') || {}).access_token;

  if (!accessToken) {
    console.error('Not connected to Vimeo - open the app and use "Connect to Vimeo" first.');
    process.exit(1);
  }
  return new Vimeo(clientId, clientSecret, accessToken);
}

// Lists a video's pictures and deletes all but `keepUri`. Mirrors removeOtherPictures() in
// server/vimeo.js, which does the same for videos published from now on.
async function tidyVideo(client, videoUri, keepUri) {
  let removed = 0;
  const listed = await client.request({ method: 'GET', path: `${videoUri}/pictures?fields=uri&per_page=100` });
  for (const picture of (listed.body && listed.body.data) || []) {
    if (!picture.uri || picture.uri === keepUri) continue;
    try {
      await client.request({ method: 'DELETE', path: picture.uri });
      removed += 1;
    } catch {
      // Some pictures can't be deleted; leaving one behind is harmless.
    }
  }
  return removed;
}

(async () => {
  const args = process.argv.slice(2);
  const tidy = args.includes('--tidy');
  const perPage = Math.min(Math.max(parseInt(args.find((a) => /^\d+$/.test(a)), 10) || 25, 1), 100);
  const client = buildClient();

  let body;
  try {
    ({ body } = await client.request({
      method: 'GET',
      // pictures.total comes back in this same listing, so counting spares costs no extra
      // requests. Asking each video for its picture list instead meant 1 + N round-trips -
      // 51 of them for a 50-video check, run one after another.
      path: `/me/videos?per_page=${perPage}&sort=date&direction=desc&fields=uri,name,created_time,pictures.uri,pictures.type,metadata.connections.pictures.total,link`,
    }));
  } catch (err) {
    console.error('Could not read your videos from Vimeo:', err.message || err);
    process.exit(1);
  }

  const videos = (body && body.data) || [];
  if (!videos.length) {
    console.log('No videos found on the connected account.');
    return;
  }

  let custom = 0;
  let auto = 0;
  let spares = 0;
  let tidied = 0;
  console.log(`\nMost recent ${videos.length} video(s) on the connected Vimeo account:\n`);
  for (const v of videos) {
    const type = (v.pictures && v.pictures.type) || 'unknown';
    const isCustom = type === 'custom';
    if (isCustom) custom += 1; else auto += 1;
    const date = (v.created_time || '').slice(0, 10);
    const mark = isCustom ? 'custom  ' : 'VIMEO’S ';
    const note = !isCustom && date && date < FIX_DATE ? '  (published before the fix)' : '';

    // How many pictures this video carries beyond the one on display, taken from the listing
    // above. Only falls back to asking this video directly if the count didn't come through.
    const total = v.metadata && v.metadata.connections && v.metadata.connections.pictures
      && v.metadata.connections.pictures.total;
    let extras;
    if (typeof total === 'number') {
      extras = Math.max(total - 1, 0);
    } else {
      extras = 0;
      try {
        const listed = await client.request({ method: 'GET', path: `${v.uri}/pictures?fields=uri&per_page=100` });
        extras = Math.max((((listed.body && listed.body.data) || []).length) - 1, 0);
      } catch {
        // Not worth failing the listing over.
      }
    }
    spares += extras;
    let extraNote = extras ? `  [+${extras} spare]` : '';

    // Only tidy where the displayed thumbnail is an uploaded one, so the keeper is known good.
    if (tidy && extras && isCustom && v.pictures && v.pictures.uri) {
      try {
        const removed = await tidyVideo(client, v.uri, v.pictures.uri);
        tidied += removed;
        extraNote = `  [removed ${removed}]`;
      } catch (err) {
        extraNote = `  [could not tidy: ${err.message || err}]`;
      }
    }

    console.log(`  ${date}  ${mark}  ${(v.name || '(untitled)').slice(0, 48)}${extraNote}${note}`);
  }

  console.log(`\n  ${custom} using the uploaded graphic, ${auto} using a frame Vimeo chose.`);
  if (tidy) {
    console.log(`  ${tidied} spare thumbnail(s) deleted.`);
  } else if (spares) {
    console.log(`  ${spares} spare thumbnail(s) sitting alongside the ones on display.`);
    console.log('  Re-run with --tidy to delete them, keeping each video\'s active thumbnail.');
  }
  if (auto) {
    console.log('\n  Those marked VIMEO’S have the wrong picture. Any published before');
    console.log(`  ${FIX_DATE} could not have worked - the thumbnail upload was broken until then.`);
    console.log('  Fixing one means setting its thumbnail on vimeo.com, or re-publishing it.');
  }
  console.log('');
})();
