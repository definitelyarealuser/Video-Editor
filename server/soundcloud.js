const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * SoundCloud publishing: upload the rendered MP3 and add it to a fixed set of playlists.
 * Unlike Vimeo's legacy-token option, SoundCloud's API always requires real OAuth2
 * (Authorization Code + PKCE) - there's no equivalent of a single pasted-in access token, so
 * every install needs a Client ID/Secret one way or another.
 *
 * Two ways to provide that Client ID/Secret, same shape as vimeo.js:
 *  - The normal path: entered right in the app via the SoundCloud setup panel (see
 *    /api/soundcloud-app-config below), saved to data/soundcloud-app-config.json (gitignored).
 *  - SOUNDCLOUD_CLIENT_ID/SOUNDCLOUD_CLIENT_SECRET env vars, for anyone who'd rather manage it
 *    that way - these take priority over the saved file when set.
 * Once either is in place, "Connect SoundCloud" does the actual account authorization, and the
 * resulting refresh token is kept in data/soundcloud-tokens.json (gitignored), silently renewed
 * before each upload.
 *
 * Endpoints/behavior below are taken directly from SoundCloud's public OpenAPI spec
 * (github.com/soundcloud/api) as of mid-2026, not verified against the live API from this
 * codebase - the network this app was built in can't reach soundcloud.com.
 */

const DATA_DIR = path.join(__dirname, '..', 'data');
const TOKENS_PATH = path.join(DATA_DIR, 'soundcloud-tokens.json');
const APP_CONFIG_PATH = path.join(DATA_DIR, 'soundcloud-app-config.json');

const AUTHORIZE_URL = 'https://secure.soundcloud.com/authorize';
const TOKEN_URL = 'https://secure.soundcloud.com/oauth/token';
const API_BASE = 'https://api.soundcloud.com';

// Cached in memory after the first read - this app is the only writer of APP_CONFIG_PATH (both
// below), so there's no need to hit disk again on every getClientId()/getClientSecret()/etc.
// call. `undefined` means "not loaded yet"; `null` means "loaded, no file on disk".
let appConfigCache;

function loadAppConfig() {
  if (appConfigCache !== undefined) return appConfigCache;
  try {
    appConfigCache = JSON.parse(fs.readFileSync(APP_CONFIG_PATH, 'utf8'));
  } catch {
    appConfigCache = null;
  }
  return appConfigCache;
}

function saveAppConfig({ clientId, clientSecret, playlistIds }) {
  const existing = loadAppConfig() || {};
  const next = {
    clientId: clientId !== undefined ? String(clientId).trim() : existing.clientId || '',
    clientSecret: clientSecret !== undefined ? String(clientSecret).trim() : existing.clientSecret || '',
    playlistIds: playlistIds !== undefined ? playlistIds : existing.playlistIds || [],
  };
  if (!next.clientId || !next.clientSecret) {
    throw new Error('Both the Client ID and Client Secret are required.');
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(APP_CONFIG_PATH, JSON.stringify(next, null, 2));
  appConfigCache = next;
  return next;
}

// Clears the saved app credentials AND any connected account token - a full reset, for
// switching SoundCloud accounts or starting over after a mistake.
function clearAppConfig() {
  fs.rmSync(APP_CONFIG_PATH, { force: true });
  fs.rmSync(TOKENS_PATH, { force: true });
  appConfigCache = null;
}

function getClientId() {
  return process.env.SOUNDCLOUD_CLIENT_ID || (loadAppConfig() || {}).clientId || null;
}

function getClientSecret() {
  return process.env.SOUNDCLOUD_CLIENT_SECRET || (loadAppConfig() || {}).clientSecret || null;
}

function hasOAuthApp() {
  return !!(getClientId() && getClientSecret());
}

function getRedirectUri() {
  return process.env.SOUNDCLOUD_REDIRECT_URI || 'http://localhost:3000/api/soundcloud/oauth-callback';
}

function getPlaylistIds() {
  if (process.env.SOUNDCLOUD_PLAYLIST_IDS) {
    return process.env.SOUNDCLOUD_PLAYLIST_IDS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return (loadAppConfig() || {}).playlistIds || [];
}

// Status for the client's setup panel - never includes the client secret itself, just whether
// one's been saved, so the UI can show "already saved" without round-tripping the actual value.
function getAppConfigStatus() {
  const config = loadAppConfig();
  return {
    clientId: process.env.SOUNDCLOUD_CLIENT_ID || (config && config.clientId) || '',
    hasSecret: !!(process.env.SOUNDCLOUD_CLIENT_SECRET || (config && config.clientSecret)),
    playlistIds: getPlaylistIds(),
    lockedByEnv: !!(process.env.SOUNDCLOUD_CLIENT_ID || process.env.SOUNDCLOUD_CLIENT_SECRET),
  };
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

// Signs out of the connected SoundCloud account without touching the saved (or env-provided)
// Client ID/Secret - lets Connect SoundCloud be done again without re-entering app credentials.
// Unlike Vimeo's legacy-token path, there's no env-var-only "already connected" case here to
// worry about - SoundCloud always has a real, clearable stored token once connected at all.
function disconnect() {
  fs.rmSync(TOKENS_PATH, { force: true });
}

// Single-user local app - an in-memory map keyed by `state` is plenty for matching a PKCE
// code_verifier back up when the OAuth redirect returns seconds later, no real security
// boundary being crossed here, just plumbing.
const pendingAuth = new Map();

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function getAuthorizeUrl() {
  if (!hasOAuthApp()) {
    throw new Error('SoundCloud is not set up yet - fill in the SoundCloud setup panel in the app first.');
  }
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
  const state = base64url(crypto.randomBytes(16));
  pendingAuth.set(state, codeVerifier);
  setTimeout(() => pendingAuth.delete(state), 10 * 60 * 1000).unref();

  const params = new URLSearchParams({
    client_id: getClientId(),
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
      client_id: getClientId(),
      client_secret: getClientSecret(),
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
      client_id: getClientId(),
      client_secret: getClientSecret(),
      refresh_token: tokens.refresh_token,
    })
  );
  // Merged over what's already stored rather than replacing it outright: SoundCloud rotates
  // refresh tokens and returns the new one here, but if a response ever came back without that
  // field, overwriting wholesale would drop the only credential capable of renewing this
  // connection - silently turning a routine refresh into "you have to reconnect from scratch".
  // Merging costs nothing when the field is present and is the difference between a working and
  // a dead connection if it isn't.
  const merged = { ...tokens, ...fresh };
  saveTokens(merged);
  return merged;
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
 * Turns a playlist's ordinary share URL (soundcloud.com/user/sets/name) into its numeric ID,
 * via SoundCloud's own /resolve endpoint - the share URL doesn't contain the ID itself, so the
 * setup panel offers this as a paste-a-link alternative to hunting for it by hand.
 */
async function resolvePlaylistUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) throw new Error('Paste a SoundCloud playlist URL first.');
  let resolved;
  try {
    resolved = await apiRequest(`/resolve?url=${encodeURIComponent(trimmed)}`);
  } catch (err) {
    throw new Error('Could not find a playlist at that URL - double check it was copied in full.');
  }
  if (!resolved || resolved.kind !== 'playlist') {
    throw new Error('That URL points to something other than a playlist (a track or user, maybe) - paste a playlist link instead.');
  }
  return { id: String(resolved.id), name: resolved.title || `Playlist ${resolved.id}` };
}

/**
 * Uploads `filePath` (an MP3) to SoundCloud with the given title/description/privacy, then
 * adds it to `playlistIds` (defaults to every ID in SOUNDCLOUD_PLAYLIST_IDS if not given).
 * Playlist updates replace the whole track list, so each one is read-modify-write: fetch the
 * current tracks, append the new one, PUT the full list back. A failure adding to one playlist
 * doesn't abort the others - same per-item result reporting as Vimeo's showcase adds.
 * `artworkPath`, if given, is sent as the track's cover art in the same request - unlike Vimeo's
 * thumbnail (a separate follow-up call), SoundCloud accepts artwork right alongside the audio on
 * track creation, so a bad image just fails the one upload rather than needing its own handling.
 */
async function uploadAndPublish({ filePath, title, description, privacy, playlistIds, artworkPath, onProgress }) {
  if (onProgress) onProgress(0.1);
  const fileBuffer = await fs.promises.readFile(filePath);
  const blob = new Blob([fileBuffer], { type: 'audio/mpeg' });

  const formData = new FormData();
  formData.append('track[title]', title);
  formData.append('track[description]', description || '');
  formData.append('track[sharing]', privacy === 'public' ? 'public' : 'private');
  formData.append('track[asset_data]', blob, path.basename(filePath));

  if (artworkPath) {
    try {
      const artworkBuffer = await fs.promises.readFile(artworkPath);
      const artworkBlob = new Blob([artworkBuffer], { type: 'image/png' });
      formData.append('track[artwork_data]', artworkBlob, path.basename(artworkPath));
    } catch {
      // Non-critical - the track still uploads fine without custom artwork.
    }
  }

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
  isConnected,
  hasOAuthApp,
  getPlaylistIds,
  getPlaylistDetails,
  resolvePlaylistUrl,
  getAuthorizeUrl,
  handleOAuthCallback,
  getAppConfigStatus,
  saveAppConfig,
  clearAppConfig,
  disconnect,
  uploadAndPublish,
};
