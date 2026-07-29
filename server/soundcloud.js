const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * SoundCloud publishing: upload the rendered MP3 and add it to a fixed set of playlists.
 * Unlike Vimeo (a single static access token), SoundCloud's API requires real OAuth2
 * (Authorization Code + PKCE) - the FF SoundCloud account has to log in once via
 * /api/soundcloud/connect, after which the refresh token is kept locally (data/, gitignored,
 * same as everything else under here) and silently renewed before each upload.
 *
 * Endpoints/behavior below are taken directly from SoundCloud's public OpenAPI spec
 * (github.com/soundcloud/api) as of mid-2026, not verified against the live API from this
 * codebase - the network this app was built in can't reach soundcloud.com.
 */

const DATA_DIR = path.join(__dirname, '..', 'data');
const TOKENS_PATH = path.join(DATA_DIR, 'soundcloud-tokens.json');

const AUTHORIZE_URL = 'https://secure.soundcloud.com/authorize';
const TOKEN_URL = 'https://secure.soundcloud.com/oauth/token';
const API_BASE = 'https://api.soundcloud.com';

function isConfigured() {
  return !!(process.env.SOUNDCLOUD_CLIENT_ID && process.env.SOUNDCLOUD_CLIENT_SECRET);
}

function getRedirectUri() {
  return process.env.SOUNDCLOUD_REDIRECT_URI || 'http://localhost:3000/api/soundcloud/oauth-callback';
}

function getPlaylistIds() {
  return (process.env.SOUNDCLOUD_PLAYLIST_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function loadTokens() {
  try {
    return JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveTokens(tokens) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
}

function isConnected() {
  const tokens = loadTokens();
  return !!(tokens && tokens.refresh_token);
}

// Single-user local app - an in-memory map keyed by `state` is plenty for matching a PKCE
// code_verifier back up when the OAuth redirect returns seconds later, no real security
// boundary being crossed here, just plumbing.
const pendingAuth = new Map();

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function getAuthorizeUrl() {
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
  const state = base64url(crypto.randomBytes(16));
  pendingAuth.set(state, codeVerifier);
  setTimeout(() => pendingAuth.delete(state), 10 * 60 * 1000).unref();

  const params = new URLSearchParams({
    client_id: process.env.SOUNDCLOUD_CLIENT_ID,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || `SoundCloud token request failed (${res.status}).`);
  return { ...data, obtained_at: Date.now() };
}

async function handleOAuthCallback(code, state) {
  const codeVerifier = pendingAuth.get(state);
  if (!codeVerifier) {
    throw new Error('This SoundCloud sign-in link expired or was already used - click Connect SoundCloud again.');
  }
  pendingAuth.delete(state);

  const tokens = await tokenRequest(
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.SOUNDCLOUD_CLIENT_ID,
      client_secret: process.env.SOUNDCLOUD_CLIENT_SECRET,
      redirect_uri: getRedirectUri(),
      code,
      code_verifier: codeVerifier,
    })
  );
  saveTokens(tokens);
}

async function refreshAccessToken() {
  const tokens = loadTokens();
  if (!tokens || !tokens.refresh_token) {
    throw new Error('SoundCloud is not connected - use Connect SoundCloud first.');
  }
  const fresh = await tokenRequest(
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.SOUNDCLOUD_CLIENT_ID,
      client_secret: process.env.SOUNDCLOUD_CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
    })
  );
  saveTokens(fresh);
  return fresh;
}

async function getValidAccessToken() {
  let tokens = loadTokens();
  if (!tokens || !tokens.refresh_token) {
    throw new Error('SoundCloud is not connected - use Connect SoundCloud first.');
  }
  const expiresAt = (tokens.obtained_at || 0) + (tokens.expires_in || 0) * 1000;
  // Refresh a little early rather than racing an upload against the exact expiry moment.
  if (Date.now() > expiresAt - 60000) {
    tokens = await refreshAccessToken();
  }
  return tokens.access_token;
}

// SoundCloud's Authorization header uses the legacy "OAuth <token>" scheme, not "Bearer".
async function apiRequest(pathAndQuery, options = {}) {
  const accessToken = await getValidAccessToken();
  const res = await fetch(`${API_BASE}${pathAndQuery}`, {
    ...options,
    headers: {
      Authorization: `OAuth ${accessToken}`,
      Accept: 'application/json; charset=utf-8',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`SoundCloud API error ${res.status}: ${errBody.slice(0, 300) || res.statusText}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function playlistUrn(id) {
  return id.startsWith('soundcloud:playlists:') ? id : `soundcloud:playlists:${id}`;
}

/**
 * Looks up the real title of each configured playlist, so the UI can offer a friendly
 * checkbox list instead of raw IDs - mirrors vimeo.js's getShowcaseDetails().
 */
async function getPlaylistDetails() {
  const ids = getPlaylistIds();
  // Independent lookups, run together rather than one-at-a-time - mirrors vimeo.js's
  // getShowcaseDetails(). Promise.all keeps results aligned with the input order regardless
  // of which request actually resolves first.
  return Promise.all(
    ids.map(async (id) => {
      try {
        const playlist = await apiRequest(`/playlists/${encodeURIComponent(playlistUrn(id))}`);
        return { id, name: playlist.title || `Playlist ${id}` };
      } catch (err) {
        return { id, name: `Playlist ${id} (not found)`, error: err.message || String(err) };
      }
    })
  );
}

/**
 * Uploads `filePath` (an MP3) to SoundCloud with the given title/description/privacy, then
 * adds it to `playlistIds` (defaults to every ID in SOUNDCLOUD_PLAYLIST_IDS if not given).
 * Playlist updates replace the whole track list, so each one is read-modify-write: fetch the
 * current tracks, append the new one, PUT the full list back. A failure adding to one playlist
 * doesn't abort the others - same per-item result reporting as Vimeo's showcase adds.
 */
async function uploadAndPublish({ filePath, title, description, privacy, playlistIds, onProgress }) {
  if (onProgress) onProgress(0.1);
  const fileBuffer = await fs.promises.readFile(filePath);
  const blob = new Blob([fileBuffer], { type: 'audio/mpeg' });

  const formData = new FormData();
  formData.append('track[title]', title);
  formData.append('track[description]', description || '');
  formData.append('track[sharing]', privacy === 'public' ? 'public' : 'private');
  formData.append('track[asset_data]', blob, path.basename(filePath));

  if (onProgress) onProgress(0.4);
  const track = await apiRequest('/tracks', { method: 'POST', body: formData });
  if (onProgress) onProgress(0.7);

  const trackUrl = track.permalink_url;
  const trackUrn = track.urn;

  const targetPlaylistIds = playlistIds || getPlaylistIds();
  const playlistResults = [];
  for (const playlistId of targetPlaylistIds) {
    try {
      const urn = playlistUrn(playlistId);
      const playlist = await apiRequest(`/playlists/${encodeURIComponent(urn)}`);
      const existingTracks = (playlist.tracks || []).map((t) => ({ urn: t.urn }));
      await apiRequest(`/playlists/${encodeURIComponent(urn)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: [...existingTracks, { urn: trackUrn }] }),
      });
      playlistResults.push({ playlistId, ok: true });
    } catch (err) {
      playlistResults.push({ playlistId, ok: false, error: err.message || String(err) });
    }
  }

  if (onProgress) onProgress(1);
  return { trackUrl, trackUrn, playlistResults };
}

module.exports = {
  isConfigured,
  isConnected,
  getPlaylistIds,
  getPlaylistDetails,
  getAuthorizeUrl,
  handleOAuthCallback,
  uploadAndPublish,
};
