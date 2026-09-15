#!/usr/bin/env node
/**
 * Lists recent Vimeo videos and says, for each, whether its thumbnail is the graphic that was
 * uploaded with it or a frame Vimeo picked by itself.
 *
 * Custom thumbnails were broken until 2026-09-06 - the app looked for the upload link under the
 * wrong field, so every one failed and Vimeo fell back to its own frame. This answers "which of
 * our videos are affected" in one go, rather than opening each one to look.
 *
 * Run from the app's folder:   node tools/check-vimeo-thumbnails.js
 * Optionally pass how many to check (default 25, max 100):
 *                              node tools/check-vimeo-thumbnails.js 50
 *
 * Read-only: it fetches video metadata and changes nothing.
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

(async () => {
  const perPage = Math.min(Math.max(parseInt(process.argv[2], 10) || 25, 1), 100);
  const client = buildClient();

  let body;
  try {
    ({ body } = await client.request({
      method: 'GET',
      path: `/me/videos?per_page=${perPage}&sort=date&direction=desc&fields=uri,name,created_time,pictures.type,link`,
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
  console.log(`\nMost recent ${videos.length} video(s) on the connected Vimeo account:\n`);
  for (const v of videos) {
    const type = (v.pictures && v.pictures.type) || 'unknown';
    const isCustom = type === 'custom';
    if (isCustom) custom += 1; else auto += 1;
    const date = (v.created_time || '').slice(0, 10);
    const mark = isCustom ? 'custom  ' : 'VIMEO’S ';
    const note = !isCustom && date && date < FIX_DATE ? '  (published before the fix)' : '';
    console.log(`  ${date}  ${mark}  ${(v.name || '(untitled)').slice(0, 58)}${note}`);
  }

  console.log(`\n  ${custom} using the uploaded graphic, ${auto} using a frame Vimeo chose.`);
  if (auto) {
    console.log('\n  Those marked VIMEO’S have the wrong picture. Any published before');
    console.log(`  ${FIX_DATE} could not have worked - the thumbnail upload was broken until then.`);
    console.log('  Fixing one means setting its thumbnail on vimeo.com, or re-publishing it.');
  }
  console.log('');
})();
