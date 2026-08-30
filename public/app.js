(() => {
  const state = {
    png: null,
    squareArt: null,
    videoJobId: null,
    videoDuration: 0,
  };

  const dzPng = document.getElementById('dz-png');
  const dzVideo = document.getElementById('dz-video');
  const dzSquareArt = document.getElementById('dz-square-art');
  const inputPng = document.getElementById('input-png');
  const inputVideo = document.getElementById('input-video');
  const inputSquareArt = document.getElementById('input-square-art');
  const renderBtn = document.getElementById('render-btn');
  const renderRequirements = document.getElementById('render-requirements');
  const form = document.getElementById('render-form');

  const videoUploadPct = document.getElementById('video-upload-pct');
  const videoUploadFill = document.getElementById('video-upload-fill');

  const progressSection = document.getElementById('progress-section');
  const progressFill = document.getElementById('progress-fill');
  const progressLabel = document.getElementById('progress-label');
  const progressTime = document.getElementById('progress-time');

  const resultSection = document.getElementById('result-section');
  const resultPreview = document.getElementById('result-preview');
  const downloadLink = document.getElementById('download-link');
  const downloadMp3Link = document.getElementById('download-mp3-link');
  const videoSaveStatus = document.getElementById('video-save-status');
  const audioSaveStatus = document.getElementById('audio-save-status');

  const errorSection = document.getElementById('error-section');
  const errorMessage = document.getElementById('error-message');

  // Fills an error-box container with a plain-English message, plus (if `detail` is present -
  // e.g. raw ffmpeg stderr) a "Show technical details" toggle that reveals it in a scrollable
  // monospace block instead of dumping it straight into the main message text.
  function setErrorWithDetail(container, message, detail) {
    container.innerHTML = '';
    container.hidden = false;
    const msgEl = document.createElement('div');
    msgEl.textContent = message;
    container.appendChild(msgEl);
    if (detail) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'error-detail-toggle';
      toggle.textContent = 'Show technical details';
      const pre = document.createElement('pre');
      pre.className = 'error-detail';
      pre.textContent = detail;
      pre.hidden = true;
      toggle.addEventListener('click', () => {
        pre.hidden = !pre.hidden;
        toggle.textContent = pre.hidden ? 'Show technical details' : 'Hide technical details';
      });
      container.appendChild(toggle);
      container.appendChild(pre);
    }
  }

  const startOverSection = document.getElementById('start-over-section');
  const startOverBtn = document.getElementById('start-over-btn');
  startOverBtn.addEventListener('click', () => window.location.reload());

  // Re-Edit jumps straight back into trimming the same video a just-finished render used -
  // everything else (bookend image, name fields, Core Text, quality/save-path settings) is
  // left exactly as it is, only the trim range resets to the full file so a start/end mistake
  // can be fixed without re-entering anything or re-uploading a possibly huge source file.
  const reEditBtn = document.getElementById('reedit-btn');
  reEditBtn.addEventListener('click', () => {
    if (!state.lastVideoJobId || !state.lastVideoFile) return;
    resultSection.hidden = true;
    vimeoStatusSection.hidden = true;
    soundcloudStatusSection.hidden = true;
    errorSection.hidden = true;
    startOverSection.hidden = true;
    reEditBtn.hidden = true;
    audioSaveStatus.hidden = true;
    downloadMp3Link.hidden = true;
    renderBtn.textContent = idleRenderLabel();
    enterVideoEditingState(state.lastVideoJobId, state.lastVideoFile, state.lastVideoDuration);
  });

  const vimeoStatusSection = document.getElementById('vimeo-status-section');
  const vimeoProgressFill = document.getElementById('vimeo-progress-fill');
  const vimeoStatusLabel = document.getElementById('vimeo-status-label');
  const vimeoResult = document.getElementById('vimeo-result');
  const vimeoResultLink = document.getElementById('vimeo-result-link');
  const vimeoShowcaseList = document.getElementById('vimeo-showcase-list');
  const vimeoError = document.getElementById('vimeo-error');

  const vimeoConfirmOverlay = document.getElementById('vimeo-confirm-overlay');
  const vimeoShowcaseChecks = document.getElementById('vimeo-showcase-checks');
  const vimeoCancelBtn = document.getElementById('vimeo-cancel-btn');
  const renderOnlyBtn = document.getElementById('render-only-btn');
  const renderPublishBtn = document.getElementById('render-publish-btn');

  const soundcloudStatusSection = document.getElementById('soundcloud-status-section');
  const soundcloudProgressFill = document.getElementById('soundcloud-progress-fill');
  const soundcloudStatusLabel = document.getElementById('soundcloud-status-label');
  const soundcloudResult = document.getElementById('soundcloud-result');
  const soundcloudResultLink = document.getElementById('soundcloud-result-link');
  const soundcloudPlaylistList = document.getElementById('soundcloud-playlist-list');
  const soundcloudError = document.getElementById('soundcloud-error');

  const soundcloudConfirmOverlay = document.getElementById('soundcloud-confirm-overlay');
  const soundcloudPlaylistChecks = document.getElementById('soundcloud-playlist-checks');
  const soundcloudCancelBtn = document.getElementById('soundcloud-cancel-btn');
  const soundcloudRenderOnlyBtn = document.getElementById('soundcloud-render-only-btn');
  const soundcloudRenderPublishBtn = document.getElementById('soundcloud-render-publish-btn');

  const soundcloudConnectStatus = document.getElementById('soundcloud-connect-status');
  const soundcloudConnectBtn = document.getElementById('soundcloud-connect-btn');
  const soundcloudToggleSetupBtn = document.getElementById('soundcloud-toggle-setup-btn');
  const soundcloudSetupForm = document.getElementById('soundcloud-setup-form');
  const soundcloudClientIdInput = document.getElementById('soundcloud-client-id-input');
  const soundcloudClientSecretInput = document.getElementById('soundcloud-client-secret-input');
  const soundcloudPlaylistIdsInput = document.getElementById('soundcloud-playlist-ids-input');
  const soundcloudPlaylistLookupInput = document.getElementById('soundcloud-playlist-lookup-input');
  const soundcloudPlaylistLookupBtn = document.getElementById('soundcloud-playlist-lookup-btn');
  const soundcloudPlaylistLookupStatus = document.getElementById('soundcloud-playlist-lookup-status');
  const soundcloudSetupLockedNote = document.getElementById('soundcloud-setup-locked-note');
  const soundcloudSetupError = document.getElementById('soundcloud-setup-error');
  const soundcloudSetupResetBtn = document.getElementById('soundcloud-setup-reset-btn');
  const soundcloudSetupDisconnectBtn = document.getElementById('soundcloud-setup-disconnect-btn');
  const soundcloudSetupCancelBtn = document.getElementById('soundcloud-setup-cancel-btn');
  const soundcloudSetupSaveBtn = document.getElementById('soundcloud-setup-save-btn');

  const vimeoConnectStatus = document.getElementById('vimeo-connect-status');
  const vimeoConnectBtn = document.getElementById('vimeo-connect-btn');
  const vimeoToggleSetupBtn = document.getElementById('vimeo-toggle-setup-btn');
  const vimeoSetupForm = document.getElementById('vimeo-setup-form');
  const vimeoClientIdInput = document.getElementById('vimeo-client-id-input');
  const vimeoClientSecretInput = document.getElementById('vimeo-client-secret-input');
  const vimeoShowcaseIdsInput = document.getElementById('vimeo-showcase-ids-input');
  const vimeoSetupLockedNote = document.getElementById('vimeo-setup-locked-note');
  const vimeoSetupError = document.getElementById('vimeo-setup-error');
  const vimeoSetupResetBtn = document.getElementById('vimeo-setup-reset-btn');
  const vimeoSetupDisconnectBtn = document.getElementById('vimeo-setup-disconnect-btn');
  const vimeoSetupCancelBtn = document.getElementById('vimeo-setup-cancel-btn');
  const vimeoSetupSaveBtn = document.getElementById('vimeo-setup-save-btn');

  state.vimeoConnected = false;
  state.vimeoHasOAuthApp = false;
  let vimeoSetupOpen = false;

  // Shows/hides the status row's pieces based on where things stand - connected (either method),
  // OAuth app saved but not yet connected, or nothing set up at all. A legacy VIMEO_ACCESS_TOKEN
  // is already connected with nothing left to configure, so the setup panel itself hides then -
  // there's nothing there for that path to do.
  function refreshVimeoConnectUI() {
    const legacyConnected = state.vimeoConnected && !state.vimeoHasOAuthApp;
    // Credentials saved but the account isn't linked yet - Connect to Vimeo is the primary
    // action here, so its status text is redundant, but editing/resetting the saved credentials
    // should still be reachable - just as a lighter-weight text link instead of a second button
    // competing with Connect to Vimeo.
    const readyToConnect = !state.vimeoConnected && state.vimeoHasOAuthApp;
    if (state.vimeoConnected) {
      vimeoConnectStatus.hidden = false;
      vimeoConnectStatus.textContent = 'Vimeo: connected';
      vimeoConnectStatus.classList.add('connected');
      vimeoConnectBtn.hidden = true;
    } else {
      // Neither "not connected" nor "not set up" needs spelling out in text - the button next
      // to it (Connect to Vimeo, or Set up Vimeo publishing…) already makes that obvious.
      vimeoConnectStatus.hidden = true;
      vimeoConnectStatus.classList.remove('connected');
      vimeoConnectBtn.hidden = !readyToConnect;
    }
    vimeoToggleSetupBtn.hidden = legacyConnected;
    if (state.vimeoHasOAuthApp) {
      // "Set up Vimeo publishing…" (nothing saved yet) is the only state with no adjacent
      // primary action, so it's the only one that stays a boxed button - both "ready to
      // connect" and "connected" already have one (Connect to Vimeo, or nothing needed at all),
      // so this is just a lighter-weight link to reach the same settings/disconnect popup.
      vimeoToggleSetupBtn.textContent = readyToConnect ? 'Edit Vimeo Connection' : 'Vimeo settings…';
      vimeoToggleSetupBtn.classList.remove('vimeo-rect-btn');
      vimeoToggleSetupBtn.classList.add('soundcloud-connect-link');
    } else {
      vimeoToggleSetupBtn.textContent = 'Set up Vimeo publishing…';
      vimeoToggleSetupBtn.classList.remove('soundcloud-connect-link');
      vimeoToggleSetupBtn.classList.add('vimeo-rect-btn');
    }
  }

  function refreshVimeoShowcases() {
    return fetch('/api/vimeo-showcases')
      .then((res) => res.json())
      .then((data) => {
        state.vimeoShowcases = data.showcases || [];
      })
      .catch(() => {});
  }

  function loadVimeoStatus() {
    return fetch('/api/vimeo-status')
      .then((res) => res.json())
      .then((data) => {
        state.vimeoConnected = !!data.connected;
        state.vimeoHasOAuthApp = !!data.hasOAuthApp;
        refreshVimeoConnectUI();
      })
      .catch(() => {
        state.vimeoConnected = false;
        state.vimeoHasOAuthApp = false;
      });
  }

  // One button does double duty: while not yet connected, it reads "Connect to Vimeo" and both
  // saves what's in the fields AND goes straight to Vimeo's permission screen in a single click
  // (see the click handler below) - no separate Save-then-Connect step. Once actually connected,
  // it reads "Save" and just persists edits (reconnecting isn't needed, or wanted, at that point).
  function updateVimeoSetupDialogActions(lockedByEnv) {
    vimeoSetupSaveBtn.textContent = state.vimeoConnected ? 'Save' : 'Connect to Vimeo';
    vimeoSetupSaveBtn.hidden = lockedByEnv;
    vimeoSetupDisconnectBtn.hidden = !state.vimeoConnected;
  }

  function openVimeoSetupForm() {
    vimeoSetupError.hidden = true;
    fetch('/api/vimeo-app-config')
      .then((res) => res.json())
      .then((data) => {
        vimeoClientIdInput.value = data.clientId || '';
        vimeoClientSecretInput.value = '';
        vimeoClientSecretInput.placeholder = data.hasSecret ? 'Already saved - leave blank to keep it' : 'Paste it here';
        vimeoShowcaseIdsInput.value = (data.showcaseIds || []).join(', ');
        vimeoSetupLockedNote.hidden = !data.lockedByEnv;
        vimeoClientIdInput.disabled = data.lockedByEnv;
        vimeoClientSecretInput.disabled = data.lockedByEnv;
        updateVimeoSetupDialogActions(data.lockedByEnv);
        vimeoSetupResetBtn.hidden = data.lockedByEnv || !state.vimeoHasOAuthApp;
      })
      .catch(() => {});
    vimeoSetupForm.hidden = false;
    vimeoSetupOpen = true;
  }

  function closeVimeoSetupForm() {
    vimeoSetupForm.hidden = true;
    vimeoSetupOpen = false;
  }

  vimeoToggleSetupBtn.addEventListener('click', () => {
    if (vimeoSetupOpen) closeVimeoSetupForm();
    else openVimeoSetupForm();
  });
  vimeoSetupCancelBtn.addEventListener('click', closeVimeoSetupForm);
  // Popup behavior matching the app's other modals - click the backdrop or press Escape to
  // back out without saving.
  vimeoSetupForm.addEventListener('click', (e) => {
    if (e.target === vimeoSetupForm) closeVimeoSetupForm();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && vimeoSetupOpen) closeVimeoSetupForm();
  });

  vimeoSetupSaveBtn.addEventListener('click', async () => {
    vimeoSetupError.hidden = true;
    const clientId = vimeoClientIdInput.value.trim();
    const clientSecret = vimeoClientSecretInput.value.trim();
    const showcaseIds = vimeoShowcaseIdsInput.value.trim();
    if (!clientId) {
      vimeoSetupError.hidden = false;
      vimeoSetupError.textContent = 'Paste in the Client Identifier from the Vimeo app page first.';
      return;
    }
    const body = { clientId, showcaseIds };
    // Leaving the secret blank on an edit means "keep the one already saved" - only require a
    // freshly-typed one when nothing's saved yet (the placeholder tells us which case this is).
    if (clientSecret) {
      body.clientSecret = clientSecret;
    } else if (!vimeoClientSecretInput.placeholder.startsWith('Already saved')) {
      vimeoSetupError.hidden = false;
      vimeoSetupError.textContent = 'Paste in the Client Secret from the Vimeo app page too.';
      return;
    }
    // Captured before the save - if this wasn't already connected, saving successfully should
    // go straight on to Connect to Vimeo, combining what used to be two clicks into one.
    const shouldConnectAfterSave = !state.vimeoConnected;
    vimeoSetupSaveBtn.disabled = true;
    try {
      const res = await fetch('/api/vimeo-app-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save Vimeo settings.');
      if (shouldConnectAfterSave) {
        window.location.href = '/api/vimeo/connect';
        return;
      }
      await loadVimeoStatus();
      await refreshVimeoShowcases();
      updateVimeoSetupDialogActions(false);
      vimeoSetupResetBtn.hidden = false;
    } catch (err) {
      vimeoSetupError.hidden = false;
      vimeoSetupError.textContent = err.message;
    } finally {
      vimeoSetupSaveBtn.disabled = false;
    }
  });

  vimeoSetupResetBtn.addEventListener('click', async () => {
    if (!window.confirm('Forget the saved Vimeo Client ID/Secret and sign out? You can set it up again any time.')) return;
    vimeoSetupResetBtn.disabled = true;
    try {
      await fetch('/api/vimeo-app-config', { method: 'DELETE' });
      await loadVimeoStatus();
      closeVimeoSetupForm();
    } catch {
      // Non-critical - worst case they just try again.
    } finally {
      vimeoSetupResetBtn.disabled = false;
    }
  });

  vimeoSetupDisconnectBtn.addEventListener('click', async () => {
    if (!window.confirm('Sign out of the connected Vimeo account? Your saved Client ID/Secret stay put - click Connect to Vimeo any time to sign back in.')) return;
    vimeoSetupDisconnectBtn.disabled = true;
    try {
      const res = await fetch('/api/vimeo/disconnect', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (data.restarting || data.manualRestartNeeded) {
        // A legacy VIMEO_ACCESS_TOKEN needed an actual restart to clear (env vars only load at
        // startup). Normally the server exits and start.command's loop relaunches it, but this
        // tab doesn't know to reload itself once that's done - and if the app wasn't started
        // through that loop there's nothing to relaunch it at all, so it stays up and the
        // restart is left to whoever's running it. Either way, say plainly what's needed.
        closeVimeoSetupForm();
        vimeoConnectStatus.hidden = false;
        vimeoConnectStatus.textContent = data.restarting
          ? 'Vimeo: signing out - restarting the app, give it a few seconds then refresh this page…'
          : 'Vimeo: signed out - restart the app for it to take effect, then refresh this page.';
        vimeoConnectStatus.classList.remove('connected');
        return;
      }
      await loadVimeoStatus();
      closeVimeoSetupForm();
    } catch {
      // Non-critical - worst case they just try again.
    } finally {
      vimeoSetupDisconnectBtn.disabled = false;
    }
  });

  loadVimeoStatus();

  state.soundcloudConnected = false;
  state.soundcloudHasOAuthApp = false;
  let soundcloudSetupOpen = false;

  // Mirrors refreshVimeoConnectUI() - SoundCloud has no legacy-token equivalent (it's always
  // real OAuth), so there's no "hide the settings toggle entirely" case to account for here.
  function refreshSoundCloudConnectUI() {
    const readyToConnect = !state.soundcloudConnected && state.soundcloudHasOAuthApp;
    if (state.soundcloudConnected) {
      soundcloudConnectStatus.hidden = false;
      soundcloudConnectStatus.textContent = 'SoundCloud: connected';
      soundcloudConnectStatus.classList.add('connected');
      soundcloudConnectBtn.hidden = true;
    } else {
      soundcloudConnectStatus.hidden = true;
      soundcloudConnectStatus.classList.remove('connected');
      soundcloudConnectBtn.hidden = !readyToConnect;
    }
    if (state.soundcloudHasOAuthApp) {
      soundcloudToggleSetupBtn.textContent = readyToConnect ? 'Edit SoundCloud Connection' : 'SoundCloud settings…';
      soundcloudToggleSetupBtn.classList.remove('vimeo-rect-btn');
      soundcloudToggleSetupBtn.classList.add('soundcloud-connect-link');
    } else {
      soundcloudToggleSetupBtn.textContent = 'Set up SoundCloud publishing…';
      soundcloudToggleSetupBtn.classList.remove('soundcloud-connect-link');
      soundcloudToggleSetupBtn.classList.add('vimeo-rect-btn');
    }
  }

  function loadSoundCloudStatus() {
    return fetch('/api/soundcloud-status')
      .then((res) => res.json())
      .then((data) => {
        state.soundcloudConnected = !!data.connected;
        state.soundcloudHasOAuthApp = !!data.hasOAuthApp;
        refreshSoundCloudConnectUI();
      })
      .catch(() => {
        state.soundcloudConnected = false;
        state.soundcloudHasOAuthApp = false;
      });
  }

  // Mirrors updateVimeoSetupDialogActions() - one button does double duty: "Connect to
  // SoundCloud" while not yet connected (saves + redirects in one click), "Save" once connected
  // (just persists edits, no redirect needed).
  function updateSoundCloudSetupDialogActions(lockedByEnv) {
    soundcloudSetupSaveBtn.textContent = state.soundcloudConnected ? 'Save' : 'Connect to SoundCloud';
    soundcloudSetupSaveBtn.hidden = lockedByEnv;
    soundcloudSetupDisconnectBtn.hidden = !state.soundcloudConnected;
  }

  function openSoundCloudSetupForm() {
    soundcloudSetupError.hidden = true;
    fetch('/api/soundcloud-app-config')
      .then((res) => res.json())
      .then((data) => {
        soundcloudClientIdInput.value = data.clientId || '';
        soundcloudClientSecretInput.value = '';
        soundcloudClientSecretInput.placeholder = data.hasSecret ? 'Already saved - leave blank to keep it' : 'Paste it here';
        soundcloudPlaylistIdsInput.value = (data.playlistIds || []).join(', ');
        soundcloudSetupLockedNote.hidden = !data.lockedByEnv;
        soundcloudClientIdInput.disabled = data.lockedByEnv;
        soundcloudClientSecretInput.disabled = data.lockedByEnv;
        updateSoundCloudSetupDialogActions(data.lockedByEnv);
        soundcloudSetupResetBtn.hidden = data.lockedByEnv || !state.soundcloudHasOAuthApp;
      })
      .catch(() => {});
    soundcloudSetupForm.hidden = false;
    soundcloudSetupOpen = true;
  }

  function closeSoundCloudSetupForm() {
    soundcloudSetupForm.hidden = true;
    soundcloudSetupOpen = false;
  }

  soundcloudToggleSetupBtn.addEventListener('click', () => {
    if (soundcloudSetupOpen) closeSoundCloudSetupForm();
    else openSoundCloudSetupForm();
  });
  soundcloudSetupCancelBtn.addEventListener('click', closeSoundCloudSetupForm);
  soundcloudSetupForm.addEventListener('click', (e) => {
    if (e.target === soundcloudSetupForm) closeSoundCloudSetupForm();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && soundcloudSetupOpen) closeSoundCloudSetupForm();
  });

  soundcloudSetupSaveBtn.addEventListener('click', async () => {
    soundcloudSetupError.hidden = true;
    const clientId = soundcloudClientIdInput.value.trim();
    const clientSecret = soundcloudClientSecretInput.value.trim();
    const playlistIds = soundcloudPlaylistIdsInput.value.trim();
    if (!clientId) {
      soundcloudSetupError.hidden = false;
      soundcloudSetupError.textContent = 'Paste in the Client ID from the SoundCloud app page first.';
      return;
    }
    const body = { clientId, playlistIds };
    if (clientSecret) {
      body.clientSecret = clientSecret;
    } else if (!soundcloudClientSecretInput.placeholder.startsWith('Already saved')) {
      soundcloudSetupError.hidden = false;
      soundcloudSetupError.textContent = 'Paste in the Client Secret from the SoundCloud app page too.';
      return;
    }
    const shouldConnectAfterSave = !state.soundcloudConnected;
    soundcloudSetupSaveBtn.disabled = true;
    try {
      const res = await fetch('/api/soundcloud-app-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save SoundCloud settings.');
      if (shouldConnectAfterSave) {
        window.location.href = '/api/soundcloud/connect';
        return;
      }
      await loadSoundCloudStatus();
      const playlistsRes = await fetch('/api/soundcloud-playlists');
      const playlistsData = await playlistsRes.json().catch(() => ({}));
      state.soundcloudPlaylists = playlistsData.playlists || [];
      closeSoundCloudSetupForm();
    } catch (err) {
      soundcloudSetupError.hidden = false;
      soundcloudSetupError.textContent = err.message;
    } finally {
      soundcloudSetupSaveBtn.disabled = false;
    }
  });

  soundcloudSetupResetBtn.addEventListener('click', async () => {
    if (!window.confirm('Forget the saved SoundCloud Client ID/Secret and sign out? You can set it up again any time.')) return;
    soundcloudSetupResetBtn.disabled = true;
    try {
      await fetch('/api/soundcloud-app-config', { method: 'DELETE' });
      await loadSoundCloudStatus();
      closeSoundCloudSetupForm();
    } catch {
      // Non-critical - worst case they just try again.
    } finally {
      soundcloudSetupResetBtn.disabled = false;
    }
  });

  soundcloudSetupDisconnectBtn.addEventListener('click', async () => {
    if (!window.confirm('Sign out of the connected SoundCloud account? Your saved Client ID/Secret stay put - click Connect to SoundCloud any time to sign back in.')) return;
    soundcloudSetupDisconnectBtn.disabled = true;
    try {
      await fetch('/api/soundcloud/disconnect', { method: 'POST' });
      await loadSoundCloudStatus();
      closeSoundCloudSetupForm();
    } catch {
      // Non-critical - worst case they just try again.
    } finally {
      soundcloudSetupDisconnectBtn.disabled = false;
    }
  });

  // A playlist's ordinary web link (soundcloud.com/user/sets/name) doesn't contain the numeric
  // ID the API needs, unlike Vimeo's showcase links - so offer to resolve it server-side (which
  // requires an active connection) instead of asking anyone to dig for it by hand.
  soundcloudPlaylistLookupBtn.addEventListener('click', async () => {
    const url = soundcloudPlaylistLookupInput.value.trim();
    soundcloudPlaylistLookupStatus.hidden = false;
    if (!url) {
      soundcloudPlaylistLookupStatus.textContent = 'Paste a playlist link first.';
      return;
    }
    soundcloudPlaylistLookupBtn.disabled = true;
    soundcloudPlaylistLookupStatus.textContent = 'Looking it up…';
    try {
      const res = await fetch(`/api/soundcloud-resolve-playlist?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not resolve that playlist URL.');
      const existingIds = soundcloudPlaylistIdsInput.value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (existingIds.includes(data.id)) {
        soundcloudPlaylistLookupStatus.textContent = `"${data.name}" (${data.id}) is already in the list above.`;
      } else {
        soundcloudPlaylistIdsInput.value = [...existingIds, data.id].join(', ');
        soundcloudPlaylistLookupStatus.textContent = `Added "${data.name}" (${data.id}) to the list above.`;
      }
      soundcloudPlaylistLookupInput.value = '';
    } catch (err) {
      soundcloudPlaylistLookupStatus.textContent = err.message;
    } finally {
      soundcloudPlaylistLookupBtn.disabled = false;
    }
  });

  loadSoundCloudStatus();

  // Fetched once, up front, same as Vimeo's showcases - only returns anything once actually
  // connected (no access token to look playlists up with otherwise).
  state.soundcloudPlaylists = [];
  fetch('/api/soundcloud-playlists')
    .then((res) => res.json())
    .then((data) => {
      state.soundcloudPlaylists = data.playlists || [];
    })
    .catch(() => {
      state.soundcloudPlaylists = [];
    });

  // After the OAuth redirect bounces back from Vimeo (see server's /api/vimeo/oauth-callback),
  // show a one-off confirmation/error, then scrub the query string so a page refresh doesn't
  // repeat it. Mirrors handleSoundCloudOAuthReturn below.
  (function handleVimeoOAuthReturn() {
    const params = new URLSearchParams(window.location.search);
    const vimeoResult = params.get('vimeo');
    if (!vimeoResult) return;
    if (vimeoResult === 'connected') {
      loadVimeoStatus().then(refreshVimeoShowcases);
    } else if (vimeoResult === 'error') {
      const message = params.get('message') || 'Could not connect to Vimeo.';
      errorSection.hidden = false;
      errorMessage.textContent = `Vimeo: ${message}`;
    }
    params.delete('vimeo');
    params.delete('message');
    const newQuery = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (newQuery ? `?${newQuery}` : ''));
  })();

  // After the OAuth redirect bounces back from SoundCloud (see server's /oauth-callback), show
  // a one-off confirmation/error, then scrub the query string so a page refresh doesn't repeat it.
  (function handleSoundCloudOAuthReturn() {
    const params = new URLSearchParams(window.location.search);
    const scResult = params.get('soundcloud');
    if (!scResult) return;
    if (scResult === 'connected') {
      loadSoundCloudStatus().then(() => {
        fetch('/api/soundcloud-playlists')
          .then((res) => res.json())
          .then((data) => {
            state.soundcloudPlaylists = data.playlists || [];
          })
          .catch(() => {});
      });
    } else if (scResult === 'error') {
      const message = params.get('message') || 'Could not connect to SoundCloud.';
      errorSection.hidden = false;
      errorMessage.textContent = `SoundCloud: ${message}`;
    }
    params.delete('soundcloud');
    params.delete('message');
    const newQuery = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (newQuery ? `?${newQuery}` : ''));
  })();

  // Fetched once, up front, so opening the dialog doesn't need a network round-trip - real
  // showcase names beat showing raw IDs to choose from.
  state.vimeoShowcases = [];
  fetch('/api/vimeo-showcases')
    .then((res) => res.json())
    .then((data) => {
      state.vimeoShowcases = data.showcases || [];
    })
    .catch(() => {
      state.vimeoShowcases = [];
    });

  function renderVimeoShowcaseChecks() {
    vimeoShowcaseChecks.innerHTML = '';
    if (!state.vimeoShowcases.length) {
      const note = document.createElement('div');
      note.className = 'showcase-load-error';
      note.textContent = 'No showcases configured (VIMEO_SHOWCASE_IDS) - the video will just upload without being added to one.';
      vimeoShowcaseChecks.appendChild(note);
      return;
    }
    state.vimeoShowcases.forEach((s) => {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = s.id;
      // Only "Fullerton Free Sermons" is on by default - the year/series showcases change
      // often enough that defaulting them on risks silently adding a video to the wrong one.
      checkbox.checked = /fullerton free sermons/i.test(s.name);
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(s.name));
      vimeoShowcaseChecks.appendChild(label);
    });
  }

  // Resolves with { cancelled: true } if the user backs out entirely (Cancel, clicking outside
  // the dialog, or Escape) - the caller should skip rendering altogether in that case. Otherwise
  // resolves with { publish, description, showcaseIds } - always a deliberate choice each time
  // (no "remember this" option), per how this app is meant to be used.
  function confirmVimeoPublish() {
    return new Promise((resolve) => {
      renderVimeoShowcaseChecks();
      vimeoConfirmOverlay.hidden = false;

      const onCancel = () => {
        cleanup();
        resolve({ cancelled: true });
      };
      const onRenderOnly = () => {
        cleanup();
        resolve({ publish: false, showcaseIds: [] });
      };
      const onRenderPublish = () => {
        const showcaseIds = Array.from(vimeoShowcaseChecks.querySelectorAll('input[type="checkbox"]:checked')).map((c) => c.value);
        const privacy = document.getElementById('vimeo-privacy').value;
        cleanup();
        resolve({ publish: true, showcaseIds, privacy });
      };
      const onOverlayClick = (e) => {
        if (e.target === vimeoConfirmOverlay) onCancel();
      };
      const onKeydown = (e) => {
        if (e.key === 'Escape') onCancel();
      };
      function cleanup() {
        vimeoConfirmOverlay.hidden = true;
        vimeoCancelBtn.removeEventListener('click', onCancel);
        renderOnlyBtn.removeEventListener('click', onRenderOnly);
        renderPublishBtn.removeEventListener('click', onRenderPublish);
        vimeoConfirmOverlay.removeEventListener('click', onOverlayClick);
        document.removeEventListener('keydown', onKeydown);
      }
      vimeoCancelBtn.addEventListener('click', onCancel);
      renderOnlyBtn.addEventListener('click', onRenderOnly);
      renderPublishBtn.addEventListener('click', onRenderPublish);
      vimeoConfirmOverlay.addEventListener('click', onOverlayClick);
      document.addEventListener('keydown', onKeydown);
    });
  }

  function renderSoundCloudPlaylistChecks() {
    soundcloudPlaylistChecks.innerHTML = '';
    if (!state.soundcloudPlaylists.length) {
      const note = document.createElement('div');
      note.className = 'showcase-load-error';
      note.textContent = 'No playlists configured (SOUNDCLOUD_PLAYLIST_IDS) - the track will just upload without being added to one.';
      soundcloudPlaylistChecks.appendChild(note);
      return;
    }
    state.soundcloudPlaylists.forEach((p) => {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = p.id;
      checkbox.checked = true; // just the two configured sermon playlists - both fine on by default
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(p.name));
      soundcloudPlaylistChecks.appendChild(label);
    });
  }

  // Same shape/behavior as confirmVimeoPublish() - a separate, deliberate confirmation each
  // time rather than combined into the Vimeo dialog, so a "no" on one doesn't quietly affect
  // the other. Cancel here backs out of the whole render, same as Vimeo's Cancel does.
  function confirmSoundCloudPublish() {
    return new Promise((resolve) => {
      renderSoundCloudPlaylistChecks();
      soundcloudConfirmOverlay.hidden = false;

      const onCancel = () => {
        cleanup();
        resolve({ cancelled: true });
      };
      const onRenderOnly = () => {
        cleanup();
        resolve({ publish: false, playlistIds: [] });
      };
      const onRenderPublish = () => {
        const playlistIds = Array.from(soundcloudPlaylistChecks.querySelectorAll('input[type="checkbox"]:checked')).map((c) => c.value);
        const privacy = document.getElementById('soundcloud-privacy').value;
        cleanup();
        resolve({ publish: true, playlistIds, privacy });
      };
      const onOverlayClick = (e) => {
        if (e.target === soundcloudConfirmOverlay) onCancel();
      };
      const onKeydown = (e) => {
        if (e.key === 'Escape') onCancel();
      };
      function cleanup() {
        soundcloudConfirmOverlay.hidden = true;
        soundcloudCancelBtn.removeEventListener('click', onCancel);
        soundcloudRenderOnlyBtn.removeEventListener('click', onRenderOnly);
        soundcloudRenderPublishBtn.removeEventListener('click', onRenderPublish);
        soundcloudConfirmOverlay.removeEventListener('click', onOverlayClick);
        document.removeEventListener('keydown', onKeydown);
      }
      soundcloudCancelBtn.addEventListener('click', onCancel);
      soundcloudRenderOnlyBtn.addEventListener('click', onRenderOnly);
      soundcloudRenderPublishBtn.addEventListener('click', onRenderPublish);
      soundcloudConfirmOverlay.addEventListener('click', onOverlayClick);
      document.addEventListener('keydown', onKeydown);
    });
  }

  const normalizeAudioCheckbox = document.getElementById('normalizeAudio');
  const targetLufsSelect = document.getElementById('targetLufs');
  normalizeAudioCheckbox.addEventListener('change', () => {
    targetLufsSelect.disabled = !normalizeAudioCheckbox.checked;
  });
  targetLufsSelect.disabled = !normalizeAudioCheckbox.checked;

  const exportMp3Checkbox = document.getElementById('exportMp3');
  // The idle label reflects whatever's checked right now - only touched outside an
  // in-flight render, so it never clobbers the "Rendering…" state.
  function idleRenderLabel() {
    return exportMp3Checkbox.checked ? 'Render Audio and Video' : 'Render Video';
  }
  function refreshIdleRenderLabel() {
    if (renderBtn.textContent !== 'Rendering…') renderBtn.textContent = idleRenderLabel();
  }
  exportMp3Checkbox.addEventListener('change', refreshIdleRenderLabel);
  refreshIdleRenderLabel();

  // Saving locally is entirely optional (unchecked by default - Vimeo/SoundCloud publishing
  // covers most people's needs now) - checking it reveals the video path field, and the audio
  // path field on top of that only when "Render MP3" is actually checked too, since there's
  // nothing to save otherwise.
  const saveLocallyCheckbox = document.getElementById('saveLocally');
  const videoSavePathBlock = document.getElementById('videoSavePathBlock');
  const audioSavePathBlock = document.getElementById('audioSavePathBlock');
  function updateSavePathVisibility() {
    videoSavePathBlock.hidden = !saveLocallyCheckbox.checked;
    audioSavePathBlock.hidden = !saveLocallyCheckbox.checked || !exportMp3Checkbox.checked;
  }
  saveLocallyCheckbox.addEventListener('change', updateSavePathVisibility);
  saveLocallyCheckbox.addEventListener('change', () => updateRenderButton());
  exportMp3Checkbox.addEventListener('change', updateSavePathVisibility);
  exportMp3Checkbox.addEventListener('change', () => updateRenderButton());
  updateSavePathVisibility();

  // The video/audio save-folder paths are remembered the moment either is set - via Browse or
  // typed by hand - not only after a completed render, so picking a folder sticks for next
  // time even if this session never actually renders anything.
  const videoSavePathInput = document.getElementById('videoSavePath');
  const audioSavePathInput = document.getElementById('audioSavePath');
  function saveSavePaths() {
    fetch('/api/save-paths', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoSavePath: videoSavePathInput.value.trim(), audioSavePath: audioSavePathInput.value.trim() }),
    }).catch(() => {
      // Non-critical - it just won't be remembered next time; nothing else depends on this.
    });
  }
  videoSavePathInput.addEventListener('change', saveSavePaths);
  audioSavePathInput.addEventListener('change', saveSavePaths);
  // Only required (when visible at all) once "save locally" is checked - keep the Render
  // button's enabled state current as either is typed into.
  videoSavePathInput.addEventListener('input', () => updateRenderButton());
  audioSavePathInput.addEventListener('input', () => updateRenderButton());

  fetch('/api/save-paths')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (!data) return;
      if (data.videoSavePath) videoSavePathInput.value = data.videoSavePath;
      if (data.audioSavePath) audioSavePathInput.value = data.audioSavePath;
      updateRenderButton();
    })
    .catch(() => {
      // Non-critical - the fields just stay empty.
    });

  // Pre-fill render settings with whatever was actually used last time, instead of the fixed
  // HTML defaults - this install's own preferences, remembered locally (server/history.js).
  (async function loadPreferences() {
    try {
      const res = await fetch('/api/preferences');
      if (!res.ok) return;
      const { renderSettings: s } = await res.json();
      if (!s) return;

      if (typeof s.startDuration === 'number') document.getElementById('startDuration').value = s.startDuration;
      if (typeof s.endDuration === 'number') document.getElementById('endDuration').value = s.endDuration;
      if (typeof s.transition === 'number') document.getElementById('transition').value = s.transition;
      if (typeof s.fadeOut === 'number') document.getElementById('fadeOut').value = s.fadeOut;
      if (typeof s.crossfadeAudio === 'boolean') document.getElementById('crossfadeAudio').checked = s.crossfadeAudio;
      // Normalize audio deliberately always starts unchecked rather than recalling the
      // last-used value - same reasoning as video quality/MP3 bitrate above.
      if (typeof s.targetLufs === 'number' && document.querySelector(`#targetLufs option[value="${s.targetLufs}"]`)) {
        targetLufsSelect.value = String(s.targetLufs);
      }
      if (typeof s.exportMp3 === 'boolean') exportMp3Checkbox.checked = s.exportMp3;
      // Video quality and MP3 bitrate deliberately always start at their defaults (High
      // Quality / 192 kbps) rather than recalling the last-used value like the other
      // settings here - those are the values labeled "(default)" in their dropdowns.
      updateSavePathVisibility();
      refreshIdleRenderLabel();
    } catch {
      // Non-critical - just leave the HTML defaults in place.
    }
  })();

  // --- Trim panel ---
  const trimPanel = document.getElementById('trim-panel');
  const qualityPanel = document.getElementById('quality-panel');
  const trimStartHandle = document.getElementById('trim-start-handle');
  const trimEndHandle = document.getElementById('trim-end-handle');
  const trimRangeFill = document.getElementById('trim-range-fill');
  const trimStartLabel = document.getElementById('trim-start-label');
  const trimEndLabel = document.getElementById('trim-end-label');
  const trimDurationLabel = document.getElementById('trim-duration-label');
  const previewStartBtn = document.getElementById('preview-start-btn');
  const previewEndBtn = document.getElementById('preview-end-btn');
  const playPauseBtn = document.getElementById('play-pause-btn');
  const videoPreview = document.getElementById('video-preview');

  function formatTime(seconds) {
    seconds = Math.max(0, Math.round(seconds));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // Elapsed is just wall-clock time since the current phase started; remaining is a simple
  // linear extrapolation from the fraction complete so far (ffmpeg's own progress reporting,
  // not a separate estimate) - reliable once a little progress has actually happened,
  // meaningless before that, so it reads as "estimating" for the first couple of percent.
  let renderStartTime = null;
  function formatElapsedRemaining(fraction) {
    const elapsedSec = (Date.now() - renderStartTime) / 1000;
    const elapsedText = `Elapsed ${formatTime(elapsedSec)}`;
    if (fraction >= 0.03) {
      const remainingSec = Math.max(0, elapsedSec / fraction - elapsedSec);
      return `${elapsedText} · About ${formatTime(remainingSec)} remaining`;
    }
    return `${elapsedText} · Estimating time remaining…`;
  }

  // The MP3 (when requested) renders first, then the video - two sequential phases with very
  // different typical durations, so each gets its own elapsed-time clock rather than one
  // running total that would make the remaining-time estimate meaningless across the switch.
  let currentRenderPhase = null;
  // Tracks whether the audio-ready milestone has already been handled for this render. Kept as
  // its own flag rather than reading audioSaveStatus.hidden, since that box is only shown when
  // there's actually something to say about a local save - with local saving off (the default)
  // there isn't, and using its visibility as the latch both re-ran this block on every frame
  // and left an empty bordered box on screen.
  let audioMilestoneShown = false;
  // The render-failed message is shown once and then left alone, since the stream can keep
  // running past it while a SoundCloud publish that started earlier finishes up.
  let renderErrorShown = false;
  function updateRenderProgressUI(phaseKey, label, fraction) {
    if (currentRenderPhase !== phaseKey) {
      currentRenderPhase = phaseKey;
      renderStartTime = Date.now();
    }
    const pct = Math.round(fraction * 100);
    progressFill.style.width = pct + '%';
    progressLabel.textContent = `${label}… ${pct}%`;
    progressTime.hidden = false;
    progressTime.textContent = formatElapsedRemaining(fraction);
  }

  function updateTrimUI() {
    const start = parseFloat(trimStartHandle.value);
    const end = parseFloat(trimEndHandle.value);
    const max = state.videoDuration || 1;
    trimRangeFill.style.left = `${(start / max) * 100}%`;
    trimRangeFill.style.width = `${((end - start) / max) * 100}%`;
    trimStartLabel.textContent = formatTime(start);
    trimEndLabel.textContent = formatTime(end);
    trimDurationLabel.textContent = formatTime(end - start);
    // Any trim change invalidates a previous size estimate - it was measured against a
    // different clip length, so showing it now would just be misleading.
    state.sizeEstimates = null;
    resetQualityOptionLabels();
  }

  // --- Output quality: CRF preset + MP3 bitrate, with real size estimates ---
  const videoQualitySelect = document.getElementById('videoQuality');
  const mp3BitrateSelect = document.getElementById('mp3Bitrate');
  const estimateSizeStatus = document.getElementById('estimate-size-status');
  const estimateSizeError = document.getElementById('estimate-size-error');

  const VIDEO_QUALITY_LABELS = { high: 'High Quality (default)', balanced: 'Balanced', smaller: 'Smaller File' };
  const MP3_BITRATE_LABELS = { 128: '128 kbps', 192: '192 kbps (default)', 320: '320 kbps' };

  state.sizeEstimates = null;

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    if (mb >= 1) return `${Math.round(mb)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  function resetQualityOptionLabels() {
    Array.from(videoQualitySelect.options).forEach((opt) => {
      opt.textContent = VIDEO_QUALITY_LABELS[opt.value] || opt.value;
    });
    Array.from(mp3BitrateSelect.options).forEach((opt) => {
      opt.textContent = MP3_BITRATE_LABELS[opt.value] || `${opt.value} kbps`;
    });
  }

  function updateQualityOptionLabels() {
    if (!state.sizeEstimates) {
      resetQualityOptionLabels();
      return;
    }
    const videoSizes = state.sizeEstimates.video || {};
    Array.from(videoQualitySelect.options).forEach((opt) => {
      const baseLabel = VIDEO_QUALITY_LABELS[opt.value] || opt.value;
      const size = videoSizes[opt.value];
      opt.textContent = size ? `${baseLabel} (~${formatBytes(size)})` : baseLabel;
    });
    const audioSizes = state.sizeEstimates.audio || {};
    Array.from(mp3BitrateSelect.options).forEach((opt) => {
      const baseLabel = MP3_BITRATE_LABELS[opt.value] || `${opt.value} kbps`;
      const size = audioSizes[opt.value];
      opt.textContent = size ? `${baseLabel} (~${formatBytes(size)})` : baseLabel;
    });
  }

  // Estimates run automatically now - as soon as a video's uploaded, and again whenever the
  // trim range changes - so there's no manual button to gate this behind; every caller just
  // asks for one and the debounce/in-flight guards below keep that cheap.
  let estimateInFlight = false;
  let estimatePending = false;
  let sizeEstimateDebounceTimer = null;

  // Nudge-button clicks (and slider drags) can fire several trim changes in a row - each one
  // used to kick off its own full round of ffmpeg sample encodes, piling up redundant work.
  // This waits for a short quiet period before actually asking the server for a new estimate.
  function scheduleSizeEstimate() {
    if (!state.videoJobId) return;
    clearTimeout(sizeEstimateDebounceTimer);
    sizeEstimateDebounceTimer = setTimeout(runSizeEstimate, 700);
  }

  async function runSizeEstimate() {
    if (!state.videoJobId) return;
    clearTimeout(sizeEstimateDebounceTimer);
    if (estimateInFlight) {
      // Already running one - just remember to run again with whatever's current once it
      // finishes, instead of starting a second overlapping round of ffmpeg encodes.
      estimatePending = true;
      return;
    }
    estimateInFlight = true;
    estimateSizeError.hidden = true;
    estimateSizeStatus.hidden = false;
    try {
      const res = await fetch(`/api/estimate-size/${state.videoJobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trimStart: trimStartHandle.value, trimEnd: trimEndHandle.value }),
      });
      const data = await res.json();
      if (!res.ok) {
        const err = new Error(data.error || 'Could not estimate file sizes.');
        err.detail = data.errorDetail;
        throw err;
      }
      state.sizeEstimates = data;
      updateQualityOptionLabels();
    } catch (err) {
      setErrorWithDetail(estimateSizeError, err.message, err.detail);
    } finally {
      estimateSizeStatus.hidden = true;
      estimateInFlight = false;
      if (estimatePending) {
        estimatePending = false;
        runSizeEstimate();
      }
    }
  }

  function setTrimRange(start, end) {
    trimStartHandle.value = start;
    trimEndHandle.value = end;
    updateTrimUI();
    scrubTo(start);
    scheduleSizeEstimate();
  }

  // --- Live preview while trimming ---
  // Dragging a handle seeks the (muted) preview to that exact frame in real time, so you can
  // see immediately whether you've cut into or before the right moment. Letting go of the
  // handle (or nudging it with arrow keys) then plays a short unmuted snippet at that point -
  // the last/first ~1.5s next to the cut - so you can hear it too, without a separate click.
  const SNIPPET_SECONDS = 1.5;
  const PREVIEW_END_SECONDS = 4.5; // deliberate "Preview end" click gets a longer listen than a quick drag-release snippet
  let activeTickHandler = null;

  function stopActivePlayback() {
    if (activeTickHandler) {
      videoPreview.removeEventListener('timeupdate', activeTickHandler);
      activeTickHandler = null;
    }
  }

  function playRange(from, to) {
    if (!videoPreview.src) return;
    stopActivePlayback();
    videoPreview.muted = false;
    videoPreview.currentTime = from;
    videoPreview.play().catch(() => {});
    activeTickHandler = () => {
      if (videoPreview.currentTime >= to) {
        videoPreview.pause();
        stopActivePlayback();
      }
    };
    videoPreview.addEventListener('timeupdate', activeTickHandler);
  }

  function scrubTo(time) {
    if (!videoPreview.src) return;
    stopActivePlayback();
    videoPreview.pause();
    videoPreview.muted = true;
    videoPreview.currentTime = Math.max(0, Math.min(time, state.videoDuration));
  }

  const MIN_TRIM_GAP = 1;
  trimStartHandle.addEventListener('input', () => {
    if (parseFloat(trimStartHandle.value) > parseFloat(trimEndHandle.value) - MIN_TRIM_GAP) {
      trimStartHandle.value = Math.max(0, parseFloat(trimEndHandle.value) - MIN_TRIM_GAP);
    }
    updateTrimUI();
    scrubTo(parseFloat(trimStartHandle.value));
  });
  trimStartHandle.addEventListener('change', () => {
    const start = parseFloat(trimStartHandle.value);
    const end = parseFloat(trimEndHandle.value);
    playRange(start, Math.min(start + SNIPPET_SECONDS, end));
    scheduleSizeEstimate();
  });

  trimEndHandle.addEventListener('input', () => {
    if (parseFloat(trimEndHandle.value) < parseFloat(trimStartHandle.value) + MIN_TRIM_GAP) {
      trimEndHandle.value = Math.min(state.videoDuration, parseFloat(trimStartHandle.value) + MIN_TRIM_GAP);
    }
    updateTrimUI();
    scrubTo(parseFloat(trimEndHandle.value));
  });
  trimEndHandle.addEventListener('change', () => {
    const start = parseFloat(trimStartHandle.value);
    const end = parseFloat(trimEndHandle.value);
    playRange(Math.max(start, end - SNIPPET_SECONDS), end);
    scheduleSizeEstimate();
  });

  // Fine-tune nudge buttons: step a handle by a fixed amount once dragging has gotten it
  // close, for precision a mouse drag on a slider spanning a multi-hour file can't give.
  // Reuses the same 'input'/'change' handlers as dragging, so nudging gets the identical
  // live-scrub-then-snippet-preview feedback.
  document.querySelectorAll('.nudge-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const handle = btn.dataset.handle === 'start' ? trimStartHandle : trimEndHandle;
      handle.value = parseFloat(handle.value) + parseFloat(btn.dataset.delta);
      handle.dispatchEvent(new Event('input', { bubbles: true }));
      handle.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });

  previewStartBtn.addEventListener('click', () => {
    const start = parseFloat(trimStartHandle.value);
    const end = parseFloat(trimEndHandle.value);
    playRange(start, Math.min(start + SNIPPET_SECONDS, end));
  });

  previewEndBtn.addEventListener('click', () => {
    const start = parseFloat(trimStartHandle.value);
    const end = parseFloat(trimEndHandle.value);
    playRange(Math.max(start, end - PREVIEW_END_SECONDS), end);
  });

  function updatePlayPauseLabel() {
    playPauseBtn.textContent = videoPreview.paused ? '▶ Play' : '⏹ Stop';
  }
  videoPreview.addEventListener('play', updatePlayPauseLabel);
  videoPreview.addEventListener('pause', updatePlayPauseLabel);
  videoPreview.addEventListener('ended', updatePlayPauseLabel);

  playPauseBtn.addEventListener('click', () => {
    if (!videoPreview.src) return;
    if (videoPreview.paused) {
      stopActivePlayback(); // don't let a leftover snippet auto-stop handler fight manual playback
      videoPreview.muted = false;
      videoPreview.play().catch(() => {});
    } else {
      stopActivePlayback();
      videoPreview.pause();
      videoPreview.currentTime = parseFloat(trimStartHandle.value);
    }
  });

  // --- Dropzones ---
  function setupDropzone(zone, input, onFile) {
    zone.addEventListener('click', (e) => {
      if (e.target.closest('.dz-clear') || e.target.closest('.dz-library')) return;
      input.click();
    });

    ['dragenter', 'dragover'].forEach((evt) =>
      zone.addEventListener(evt, (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
      })
    );
    ['dragleave', 'drop'].forEach((evt) =>
      zone.addEventListener(evt, (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
      })
    );
    zone.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) onFile(file);
    });

    input.addEventListener('change', () => {
      if (input.files[0]) onFile(input.files[0]);
    });

    const clearBtn = zone.querySelector('.dz-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearBtn.dispatchEvent(new CustomEvent('dz-clear-click', { bubbles: false }));
      });
    }
  }

  function showDzState(zone, stateName) {
    ['dz-empty', 'dz-uploading', 'dz-filled'].forEach((cls) => {
      const el = zone.querySelector(`.${cls}`);
      if (el) el.hidden = cls !== stateName;
    });
  }

  // Generic controller for a "previously used images" library attached to a dropzone: saving
  // newly-dropped files into it, rendering the thumbnail picker, selecting a saved image, and
  // the Edit…/delete-confirm dialogs. One instance per library (bookend graphic, square
  // SoundCloud artwork) - each is fully independent (own API path, own dropzone, own modals),
  // not shared state, so nothing about one can affect the other.
  function createImageLibraryController({
    apiPath,
    dz,
    previewImgId,
    filenameId,
    stateKey,
    librarySection,
    libraryThumbs,
    libraryEditBtn,
    editOverlay,
    editList,
    editCloseBtn,
    deleteConfirmOverlay,
    deleteConfirmName,
    deleteCancelBtn,
    deleteConfirmBtn,
  }) {
    let images = [];

    function renderThumbs() {
      librarySection.hidden = images.length === 0;
      libraryThumbs.innerHTML = '';
      images.forEach((img) => {
        const thumb = document.createElement('div');
        thumb.className = 'dz-library-thumb';
        thumb.title = img.name;

        const imageEl = document.createElement('img');
        imageEl.src = img.url;
        imageEl.alt = img.name;
        thumb.appendChild(imageEl);

        thumb.addEventListener('click', (e) => {
          e.stopPropagation();
          selectImage(img);
        });

        libraryThumbs.appendChild(thumb);
      });
    }

    function selectImage(img) {
      state[stateKey] = { libraryId: img.id, name: img.name, url: img.url };
      showDzState(dz, 'dz-filled');
      document.getElementById(previewImgId).src = img.url;
      document.getElementById(filenameId).textContent = img.name;
      updateRenderButton();
    }

    function saveToLibrary(file) {
      const formData = new FormData();
      formData.append('image', file);
      fetch(apiPath, { method: 'POST', body: formData })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data || !data.image) return;
          images = [data.image, ...images.filter((i) => i.id !== data.image.id)];
          renderThumbs();
        })
        .catch(() => {
          // Non-critical - rendering still works even if the library save fails.
        });
    }

    fetch(apiPath)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        images = data.images || [];
        renderThumbs();
      })
      .catch(() => {
        // Non-critical - the dropzone still works without the library.
      });

    // Library management: a separate "Edit…" dialog lists every saved image with a Delete
    // button, each guarded by its own confirmation dialog - deleting is deliberately a couple
    // of steps away from the one-click thumbnails used to just pick an image.
    function onEditKeydown(e) {
      if (e.key === 'Escape') closeEditOverlay();
    }
    function openEditOverlay() {
      renderEditList();
      editOverlay.hidden = false;
      document.addEventListener('keydown', onEditKeydown);
    }
    function closeEditOverlay() {
      editOverlay.hidden = true;
      document.removeEventListener('keydown', onEditKeydown);
    }

    libraryEditBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditOverlay();
    });
    editCloseBtn.addEventListener('click', closeEditOverlay);
    editOverlay.addEventListener('click', (e) => {
      if (e.target === editOverlay) closeEditOverlay();
    });

    function renderEditList() {
      editList.innerHTML = '';
      if (images.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'library-edit-empty';
        empty.textContent = 'No saved images yet.';
        editList.appendChild(empty);
        return;
      }
      images.forEach((img) => {
        const row = document.createElement('div');
        row.className = 'library-edit-row';

        const imageEl = document.createElement('img');
        imageEl.src = img.url;
        imageEl.alt = img.name;
        row.appendChild(imageEl);

        const name = document.createElement('div');
        name.className = 'library-edit-row-name';
        name.textContent = img.name;
        row.appendChild(name);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'library-edit-delete-btn';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', () => confirmDelete(img));
        row.appendChild(deleteBtn);

        editList.appendChild(row);
      });
    }

    function confirmDelete(img) {
      deleteConfirmName.textContent = `Delete "${img.name}"? This can't be undone.`;
      deleteConfirmOverlay.hidden = false;

      const onCancel = () => cleanup();
      const onConfirm = async () => {
        cleanup();
        try {
          await fetch(`${apiPath}/${img.id}`, { method: 'DELETE' });
        } catch {
          // Non-critical - it'll just still be there next time; not worth surfacing an error for.
        }
        images = images.filter((i) => i.id !== img.id);
        // The currently-selected image can't stay pointed at a now-deleted library entry.
        if (state[stateKey] && state[stateKey].libraryId === img.id) {
          state[stateKey] = null;
          showDzState(dz, 'dz-empty');
          updateRenderButton();
        }
        renderThumbs();
        renderEditList();
      };
      const onOverlayClick = (e) => {
        if (e.target === deleteConfirmOverlay) onCancel();
      };
      const onKeydown = (e) => {
        if (e.key === 'Escape') onCancel();
      };
      function cleanup() {
        deleteConfirmOverlay.hidden = true;
        deleteCancelBtn.removeEventListener('click', onCancel);
        deleteConfirmBtn.removeEventListener('click', onConfirm);
        deleteConfirmOverlay.removeEventListener('click', onOverlayClick);
        document.removeEventListener('keydown', onKeydown);
      }
      deleteCancelBtn.addEventListener('click', onCancel);
      deleteConfirmBtn.addEventListener('click', onConfirm);
      deleteConfirmOverlay.addEventListener('click', onOverlayClick);
      document.addEventListener('keydown', onKeydown);
    }

    return { saveToLibrary };
  }

  const bookendLibrary = createImageLibraryController({
    apiPath: '/api/bookend-images',
    dz: dzPng,
    previewImgId: 'png-preview',
    filenameId: 'png-filename',
    stateKey: 'png',
    librarySection: document.getElementById('png-library'),
    libraryThumbs: document.getElementById('png-library-thumbs'),
    libraryEditBtn: document.getElementById('png-library-edit-btn'),
    editOverlay: document.getElementById('library-edit-overlay'),
    editList: document.getElementById('library-edit-list'),
    editCloseBtn: document.getElementById('library-edit-close-btn'),
    deleteConfirmOverlay: document.getElementById('library-delete-confirm-overlay'),
    deleteConfirmName: document.getElementById('library-delete-confirm-name'),
    deleteCancelBtn: document.getElementById('library-delete-cancel-btn'),
    deleteConfirmBtn: document.getElementById('library-delete-confirm-btn'),
  });

  const squareArtLibrary = createImageLibraryController({
    apiPath: '/api/square-art-images',
    dz: dzSquareArt,
    previewImgId: 'square-art-preview',
    filenameId: 'square-art-filename',
    stateKey: 'squareArt',
    librarySection: document.getElementById('square-art-library'),
    libraryThumbs: document.getElementById('square-art-library-thumbs'),
    libraryEditBtn: document.getElementById('square-art-library-edit-btn'),
    editOverlay: document.getElementById('square-art-library-edit-overlay'),
    editList: document.getElementById('square-art-library-edit-list'),
    editCloseBtn: document.getElementById('square-art-library-edit-close-btn'),
    deleteConfirmOverlay: document.getElementById('square-art-library-delete-confirm-overlay'),
    deleteConfirmName: document.getElementById('square-art-library-delete-confirm-name'),
    deleteCancelBtn: document.getElementById('square-art-library-delete-cancel-btn'),
    deleteConfirmBtn: document.getElementById('square-art-library-delete-confirm-btn'),
  });

  // PNG dropzone (client-side only, uploaded together with the render request)
  setupDropzone(dzPng, inputPng, (file) => {
    state.png = file;
    showDzState(dzPng, 'dz-filled');
    document.getElementById('png-preview').src = URL.createObjectURL(file);
    document.getElementById('png-filename').textContent = file.name;
    updateRenderButton();
    bookendLibrary.saveToLibrary(file);
  });
  dzPng.querySelector('.dz-clear').addEventListener('dz-clear-click', () => {
    state.png = null;
    showDzState(dzPng, 'dz-empty');
    inputPng.value = '';
    updateRenderButton();
  });

  // Square SoundCloud artwork dropzone - required, same as the rectangular bookend PNG above,
  // and now has its own "previously used" library the same way.
  setupDropzone(dzSquareArt, inputSquareArt, (file) => {
    state.squareArt = file;
    showDzState(dzSquareArt, 'dz-filled');
    document.getElementById('square-art-preview').src = URL.createObjectURL(file);
    document.getElementById('square-art-filename').textContent = file.name;
    updateRenderButton();
    squareArtLibrary.saveToLibrary(file);
  });
  dzSquareArt.querySelector('.dz-clear').addEventListener('dz-clear-click', () => {
    state.squareArt = null;
    showDzState(dzSquareArt, 'dz-empty');
    inputSquareArt.value = '';
    updateRenderButton();
  });

  // Folder browser for the video/audio save-path fields - meaningful only because this app
  // always runs on the same machine as the browser using it, so a server-side directory listing
  // doubles as a native-feeling folder picker without needing a browser extension or the (very
  // limited, handle-only, no-real-path) File System Access API.
  const folderBrowserOverlay = document.getElementById('folder-browser-overlay');
  const folderBrowserCurrentPath = document.getElementById('folder-browser-current-path');
  const folderBrowserList = document.getElementById('folder-browser-list');
  const folderBrowserError = document.getElementById('folder-browser-error');
  const folderBrowserCancelBtn = document.getElementById('folder-browser-cancel-btn');
  const folderBrowserSelectBtn = document.getElementById('folder-browser-select-btn');

  let folderBrowserTargetInput = null;
  let folderBrowserCurrentDir = null;

  async function loadFolderBrowser(dirPath) {
    folderBrowserError.hidden = true;
    try {
      const url = dirPath ? `/api/browse-folders?path=${encodeURIComponent(dirPath)}` : '/api/browse-folders';
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not read that folder.');

      folderBrowserCurrentDir = data.path;
      folderBrowserCurrentPath.textContent = data.path;
      folderBrowserList.innerHTML = '';

      if (data.parent) {
        const upRow = document.createElement('div');
        upRow.className = 'folder-browser-item folder-browser-up';
        upRow.textContent = '.. (up one level)';
        upRow.addEventListener('click', () => loadFolderBrowser(data.parent));
        folderBrowserList.appendChild(upRow);
      }
      data.folders.forEach((f) => {
        const row = document.createElement('div');
        row.className = 'folder-browser-item';
        row.textContent = f.name;
        row.addEventListener('click', () => loadFolderBrowser(f.path));
        folderBrowserList.appendChild(row);
      });
    } catch (err) {
      folderBrowserError.hidden = false;
      folderBrowserError.textContent = err.message;
    }
  }

  function onFolderBrowserKeydown(e) {
    if (e.key === 'Escape') closeFolderBrowser();
  }
  function openFolderBrowser(targetInput) {
    folderBrowserTargetInput = targetInput;
    folderBrowserOverlay.hidden = false;
    document.addEventListener('keydown', onFolderBrowserKeydown);
    loadFolderBrowser(targetInput.value.trim() || null);
  }
  function closeFolderBrowser() {
    folderBrowserOverlay.hidden = true;
    folderBrowserTargetInput = null;
    document.removeEventListener('keydown', onFolderBrowserKeydown);
  }

  // Prefer the OS's own folder picker when this platform supports it (Windows/Mac) - the in-app
  // browser above only kicks in as a fallback, either on an unsupported platform or if the
  // native dialog fails to launch for some reason (e.g. PowerShell/osascript unavailable).
  let nativeFolderPickerSupported = false;
  fetch('/api/browse-folders/supported')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      nativeFolderPickerSupported = !!(data && data.supported);
    })
    .catch(() => {
      nativeFolderPickerSupported = false;
    });

  async function tryNativeFolderPicker(btn, targetInput) {
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Waiting…';
    try {
      const url = targetInput.value.trim()
        ? `/api/browse-folders/native?path=${encodeURIComponent(targetInput.value.trim())}`
        : '/api/browse-folders/native';
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not open the native folder picker.');
      if (data.path) {
        targetInput.value = data.path;
        saveSavePaths();
        updateRenderButton();
      }
      // data.path === null just means the user clicked Cancel in the native dialog - not an
      // error, nothing to do.
    } catch {
      openFolderBrowser(targetInput);
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  document.querySelectorAll('.browse-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetInput = document.getElementById(btn.dataset.target);
      if (nativeFolderPickerSupported) {
        tryNativeFolderPicker(btn, targetInput);
      } else {
        openFolderBrowser(targetInput);
      }
    });
  });
  folderBrowserCancelBtn.addEventListener('click', closeFolderBrowser);
  folderBrowserOverlay.addEventListener('click', (e) => {
    if (e.target === folderBrowserOverlay) closeFolderBrowser();
  });
  folderBrowserSelectBtn.addEventListener('click', () => {
    if (folderBrowserTargetInput && folderBrowserCurrentDir) {
      folderBrowserTargetInput.value = folderBrowserCurrentDir;
      saveSavePaths();
      updateRenderButton();
    }
    closeFolderBrowser();
  });

  // Video dropzone: uploads immediately so it can be analyzed/trimmed before rendering.
  // Puts the trim/quality editing UI into "editing this video" state - shared by a fresh
  // upload and by Re-Edit jumping back into the video a just-finished render used, without
  // needing to re-upload it.
  function enterVideoEditingState(jobId, file, duration) {
    state.videoJobId = jobId;
    state.videoFile = file;
    state.videoDuration = duration;

    showDzState(dzVideo, 'dz-filled');
    videoPreview.src = URL.createObjectURL(file);
    updatePlayPauseLabel();
    document.getElementById('video-filename').textContent = `${file.name} (${formatTime(duration)})`;

    trimStartHandle.min = 0;
    trimStartHandle.max = duration;
    trimStartHandle.step = 0.1;
    trimEndHandle.min = 0;
    trimEndHandle.max = duration;
    trimEndHandle.step = 0.1;
    setTrimRange(0, duration);
    trimPanel.hidden = false;
    qualityPanel.hidden = false;

    updateRenderButton();
  }

  function uploadVideo(file) {
    showDzState(dzVideo, 'dz-uploading');
    videoUploadFill.style.width = '0%';
    videoUploadPct.textContent = '0%';
    errorSection.hidden = true;
    startOverSection.hidden = true;

    const formData = new FormData();
    formData.append('video', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload-video');
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      videoUploadFill.style.width = pct + '%';
      videoUploadPct.textContent = pct + '%';
    };
    xhr.onload = () => {
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = {};
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        showDzState(dzVideo, 'dz-empty');
        setErrorWithDetail(errorMessage, data.error || 'Video upload failed.', data.errorDetail);
        errorSection.hidden = false;
        return;
      }

      enterVideoEditingState(data.jobId, file, data.duration);
    };
    xhr.onerror = () => {
      showDzState(dzVideo, 'dz-empty');
      errorSection.hidden = false;
      errorMessage.textContent = 'Video upload failed - check the server is running.';
    };
    xhr.send(formData);
  }

  setupDropzone(dzVideo, inputVideo, uploadVideo);
  dzVideo.querySelector('.dz-clear').addEventListener('dz-clear-click', () => {
    state.videoJobId = null;
    state.videoFile = null;
    state.videoDuration = 0;
    showDzState(dzVideo, 'dz-empty');
    inputVideo.value = '';
    trimPanel.hidden = true;
    qualityPanel.hidden = true;
    state.sizeEstimates = null;
    updateRenderButton();
  });

  // Series / Sermon Title / Speaker's Name / Sermon Date combine into a single string that
  // doubles as the rendered file name and the title sent to Vimeo (and, manually, SoundCloud).
  // All four are optional - blank ones are just skipped, not replaced with a placeholder, so a
  // partially-filled-in set of fields never leaves a dangling " - " in the name.
  const nameFieldIds = ['seriesName', 'sermonTitle', 'speakerName', 'sermonDate'];
  const outputNamePreview = document.getElementById('outputNamePreview');

  function computeOutputName() {
    const parts = nameFieldIds
      .map((id) => document.getElementById(id).value.trim())
      .filter(Boolean);
    return parts.join(' - ');
  }

  // Mirrors the server's own filename sanitizer (server/index.js's sanitizeFilename) so the
  // preview matches reality even in the all-blank case, rather than showing an empty name.
  function updateOutputNamePreview() {
    outputNamePreview.textContent = `${computeOutputName() || 'sermon-final'}.mp4`;
  }

  // The Render button is just disabled when something's missing, with no other feedback -
  // browsers never get a chance to show their own "please fill this out" validation UI either,
  // since a disabled submit button can't be clicked in the first place. This builds an explicit
  // "still needed" list instead, in the same order the fields appear on the page, so it's
  // always obvious what's left rather than leaving a greyed-out button unexplained.
  function updateRenderButton() {
    const missing = [];
    if (!state.png) missing.push('a bookend image');
    if (!state.squareArt) missing.push('a square SoundCloud graphic');
    if (!state.videoJobId) missing.push('a video file');
    // Series/Sermon Title/Speaker's Name/Sermon Date/Core Text are all optional -
    // computeOutputName() and the server's own filename sanitizer both already handle any
    // subset of the name fields being blank, and an empty description is a valid choice too.
    // Both paths only matter - and are only required - once "save locally" is checked; the
    // audio one additionally only when there'll actually be an MP3 to save.
    if (saveLocallyCheckbox.checked) {
      if (!document.getElementById('videoSavePath').value.trim()) missing.push('a folder to save the MP4 to');
      if (document.getElementById('exportMp3').checked && !document.getElementById('audioSavePath').value.trim()) {
        missing.push('a folder to save the MP3 to');
      }
    }

    renderBtn.disabled = missing.length > 0;
    renderRequirements.hidden = missing.length === 0;
    if (missing.length > 0) {
      renderRequirements.textContent = `Still needed before you can render: ${missing.join(', ')}.`;
    }
    updateOutputNamePreview();
  }

  nameFieldIds.forEach((id) => {
    document.getElementById(id).addEventListener('input', updateRenderButton);
  });
  updateRenderButton(); // populate the "still needed" checklist immediately, not just after the first edit

  const coreTextInput = document.getElementById('coreText');
  const coreTextPreview = document.getElementById('coreTextPreview');
  coreTextInput.addEventListener('input', () => {
    coreTextPreview.textContent = `Core text: ${coreTextInput.value.trim()}`;
    updateRenderButton();
  });

  function fillTodayDate() {
    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const yy = String(today.getFullYear()).slice(-2);
    const sermonDateInput = document.getElementById('sermonDate');
    sermonDateInput.value = `${mm} ${dd} ${yy}`;
    updateRenderButton();
  }

  document.getElementById('use-today-btn').addEventListener('click', fillTodayDate);

  // Desktop notification when a render finishes (or fails) while the tab isn't the one you're
  // looking at - permission has to be requested from a real user gesture (the Render click
  // itself), and browsers silently ignore a repeat request once it's been granted or denied.
  function requestNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }

  function notifyIfHidden(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!document.hidden) return; // tab's right here - a system notification would just be noise
    const notification = new Notification(title, { body });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }

  function showError(message, detail) {
    setErrorWithDetail(errorMessage, message, detail);
    errorSection.hidden = false;
    progressSection.hidden = true;
    renderBtn.disabled = false;
    renderBtn.textContent = idleRenderLabel();
    notifyIfHidden('Render failed', message);
  }

  function resetPanels() {
    errorSection.hidden = true;
    resultSection.hidden = true;
    startOverSection.hidden = true;
    reEditBtn.hidden = true;
    downloadMp3Link.hidden = true;
    vimeoStatusSection.hidden = true;
    vimeoResult.hidden = true;
    vimeoError.hidden = true;
    soundcloudStatusSection.hidden = true;
    soundcloudResult.hidden = true;
    soundcloudError.hidden = true;
    videoSaveStatus.hidden = true;
    audioSaveStatus.hidden = true;
    progressSection.hidden = false;
    progressFill.style.width = '0%';
    progressLabel.textContent = 'Uploading files…';
    progressTime.hidden = true;
    currentRenderPhase = null;
    audioMilestoneShown = false;
    renderErrorShown = false;
  }

  function finishRenderCycle() {
    renderBtn.disabled = false;
    renderBtn.textContent = idleRenderLabel();
    // Resets the dropzone/trim panel back to "no video loaded" - a fresh render needs a fresh
    // upload (or a Re-Edit click, which restores from the state.lastVideo* snapshot captured
    // just before this runs). The server keeps the uploaded video around for a while after a
    // successful render specifically so Re-Edit has something to jump back into.
    state.videoJobId = null;
    state.videoFile = null;
    state.videoDuration = 0;
    showDzState(dzVideo, 'dz-empty');
    inputVideo.value = '';
    trimPanel.hidden = true;
    qualityPanel.hidden = true;
    state.sizeEstimates = null;
    updateRenderButton();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.videoJobId || !state.png || !state.squareArt) return;

    // Asked for right on the click that starts a render - a real user gesture, which browsers
    // require for a permission prompt like this.
    requestNotificationPermission();

    // Confirmed up front, before rendering even starts, so publishing can run automatically
    // once the render finishes with no further approval needed - but it's always a fresh,
    // deliberate choice, never remembered from a previous render.
    const vimeoChoice = state.vimeoConnected
      ? await confirmVimeoPublish()
      : { publish: false, showcaseIds: [] };
    if (vimeoChoice.cancelled) return; // back out entirely - no render, nothing changes

    // SoundCloud is audio-only, so it's only offered when there'll actually be an MP3 to send -
    // asking about a platform that has nothing to upload to would just be noise.
    const willExportMp3 = document.getElementById('exportMp3').checked;
    const soundcloudChoice = (state.soundcloudConnected && willExportMp3)
      ? await confirmSoundCloudPublish()
      : { publish: false, playlistIds: [] };
    if (soundcloudChoice.cancelled) return; // same as Vimeo's Cancel - back out entirely

    const { publish: publishToVimeo, showcaseIds: vimeoShowcaseIds, privacy: vimeoPrivacy } = vimeoChoice;
    const { publish: publishToSoundCloud, playlistIds: soundcloudPlaylistIds, privacy: soundcloudPrivacy } = soundcloudChoice;
    // Read independently of either dialog - description is the same Core Text either way, and
    // needs to be correct even when only one of the two platforms is actually being published to
    // (e.g. Vimeo isn't configured at all, so vimeoChoice never touches this).
    const coreTextDescription = document.getElementById('coreText').value.trim();

    resetPanels();
    renderBtn.disabled = true;
    renderBtn.textContent = 'Rendering…';

    const formData = new FormData();
    if (state.png && state.png.libraryId) {
      formData.append('pngImageId', state.png.libraryId);
    } else {
      formData.append('png', state.png);
    }
    if (state.squareArt.libraryId) {
      formData.append('squareArtImageId', state.squareArt.libraryId);
    } else {
      formData.append('squareArt', state.squareArt);
    }
    formData.append('startDuration', document.getElementById('startDuration').value);
    formData.append('endDuration', document.getElementById('endDuration').value);
    formData.append('transition', document.getElementById('transition').value);
    formData.append('fadeOut', document.getElementById('fadeOut').value);
    formData.append('outputName', computeOutputName());
    formData.append('crossfadeAudio', document.getElementById('crossfadeAudio').checked);
    formData.append('normalizeAudio', normalizeAudioCheckbox.checked);
    formData.append('targetLufs', targetLufsSelect.value);
    formData.append('exportMp3', document.getElementById('exportMp3').checked);
    formData.append('trimStart', trimStartHandle.value);
    formData.append('trimEnd', trimEndHandle.value);
    formData.append('publishToVimeo', publishToVimeo);
    formData.append('vimeoDescription', coreTextDescription);
    formData.append('vimeoShowcaseIds', vimeoShowcaseIds.join(','));
    formData.append('vimeoPrivacy', vimeoPrivacy || 'nobody');
    formData.append('publishToSoundCloud', publishToSoundCloud);
    formData.append('soundcloudPlaylistIds', soundcloudPlaylistIds.join(','));
    formData.append('soundcloudPrivacy', soundcloudPrivacy || 'private');
    // Sent as empty (rather than whatever's still typed in a now-hidden field) when "save
    // locally" is unchecked, so the checkbox is the actual source of truth, not stale input.
    formData.append('videoSavePath', saveLocallyCheckbox.checked ? document.getElementById('videoSavePath').value.trim() : '');
    formData.append('audioSavePath', saveLocallyCheckbox.checked ? document.getElementById('audioSavePath').value.trim() : '');
    formData.append('videoQuality', videoQualitySelect.value);
    formData.append('mp3Bitrate', mp3BitrateSelect.value);

    let jobId;
    try {
      const res = await fetch(`/api/render/${state.videoJobId}`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        const err = new Error(data.error || 'Render request failed.');
        err.detail = data.errorDetail;
        throw err;
      }
      jobId = data.jobId;
    } catch (err) {
      showError(err.message, err.detail);
      return;
    }

    progressLabel.textContent = 'Rendering…';
    const source = new EventSource(`/api/progress/${jobId}`);
    source.onmessage = (evt) => {
      const data = JSON.parse(evt.data);

      // Surfaced as soon as it happens, but this deliberately doesn't close the stream or bail
      // out of the rest of this handler: the MP3 renders and uploads to SoundCloud before the
      // video pass even starts, so a failed video can coexist with a SoundCloud publish that's
      // still running and has its own result worth showing. The server keeps the stream open
      // until that settles too, and flags the real last frame with streamDone below.
      if (data.status === 'error' && !renderErrorShown) {
        renderErrorShown = true;
        showError(data.error || 'Rendering failed.', data.errorDetail);
      }

      // Two sequential phases while status is still 'rendering': the MP3 (if requested) goes
      // first since it's dramatically faster (no PNG, no libx264 encode), then the video.
      if (data.status === 'rendering') {
        if (data.mp3Status === 'rendering') {
          updateRenderProgressUI('audio', 'Rendering audio', data.mp3Progress || 0);
        } else {
          updateRenderProgressUI('video', 'Rendering video', data.progress || 0);
        }
      }

      // Audio-ready milestone: reveals as soon as the fast audio pass settles (done or
      // failed), independent of the video - which is likely still going for a while yet -
      // so the MP3 can be grabbed/uploaded to SoundCloud right away instead of waiting.
      if (data.mp3Status && data.mp3Status !== 'rendering' && !audioMilestoneShown) {
        audioMilestoneShown = true;
        // Each branch reveals the box itself - when local saving is off there's simply nothing
        // to report here, so it stays hidden rather than showing an empty one. Mirrors how the
        // video's own save status below is handled.
        if (data.mp3Status === 'error') {
          audioSaveStatus.hidden = false;
          audioSaveStatus.className = 'save-status audio-save-status-standalone save-failed';
          setErrorWithDetail(audioSaveStatus, data.mp3Error || 'Could not render the MP3.', data.mp3ErrorDetail);
        } else if (data.audioSavedTo) {
          audioSaveStatus.hidden = false;
          audioSaveStatus.className = 'save-status audio-save-status-standalone save-ok';
          audioSaveStatus.textContent = `Audio saved to ${data.audioSavedTo}`;
        } else if (data.audioSaveError) {
          audioSaveStatus.hidden = false;
          audioSaveStatus.className = 'save-status audio-save-status-standalone save-failed';
          audioSaveStatus.textContent = `Could not save audio to that folder: ${data.audioSaveError}`;
        }

        if (data.hasMp3 && data.mp3Status === 'done') {
          downloadMp3Link.href = `/api/download/${jobId}/mp3`;
          downloadMp3Link.download = computeOutputName() + '.mp3';
          // Same policy as the MP4 download button above - hidden only once an actual local
          // save succeeded.
          downloadMp3Link.hidden = !!data.audioSavedTo;
        }
      }

      // SoundCloud publishing can start as soon as the MP3 is ready, well before the video -
      // reveal its status section independently rather than waiting on the video result below.
      if (data.scStatus && soundcloudStatusSection.hidden) {
        soundcloudStatusSection.hidden = false;
        soundcloudProgressFill.style.width = '0%';
        soundcloudStatusLabel.textContent = 'Publishing to SoundCloud…';
      }

      // The video result panel shows once the video itself is done (status has moved past
      // 'rendering') - the MP3/SoundCloud milestones above may well have already happened by
      // this point, or may still be in progress; they're tracked independently either way.
      if (data.status !== 'rendering' && data.status !== 'error' && resultSection.hidden) {
        progressSection.hidden = true;
        resultSection.hidden = false;
        const outputName = computeOutputName();
        const url = `/api/download/${jobId}`;
        resultPreview.src = url;
        downloadLink.href = url;
        downloadLink.download = outputName + '.mp4';
        // Hidden only once an actual local save succeeded (the confirmation text below covers
        // that case) - shown both when the save failed and when local save wasn't requested at
        // all, since download is the only way left to get the file either way.
        downloadLink.hidden = !!data.videoSavedTo;

        if (data.videoSavedTo) {
          videoSaveStatus.hidden = false;
          videoSaveStatus.className = 'save-status save-ok';
          videoSaveStatus.textContent = `Video saved to ${data.videoSavedTo}`;
        } else if (data.videoSaveError) {
          videoSaveStatus.hidden = false;
          videoSaveStatus.className = 'save-status save-failed';
          videoSaveStatus.textContent = `Could not save video to that folder: ${data.videoSaveError}`;
        }

        if (publishToVimeo) {
          vimeoStatusSection.hidden = false;
          vimeoProgressFill.style.width = '0%';
          vimeoStatusLabel.textContent = 'Publishing to Vimeo…';
        }
      }

      if (data.status === 'publishing') {
        const pct = Math.round((data.progress || 0) * 100);
        vimeoProgressFill.style.width = pct + '%';
        vimeoStatusLabel.textContent = `Publishing to Vimeo… ${pct}%`;
      }

      if (data.status === 'published') {
        vimeoProgressFill.style.width = '100%';
        vimeoStatusLabel.textContent = 'Published to Vimeo';
        vimeoResult.hidden = false;
        vimeoResultLink.href = data.vimeoUrl;
        vimeoResultLink.textContent = data.vimeoUrl;
        vimeoShowcaseList.innerHTML = '';
        if (data.vimeoThumbnailError) {
          const li = document.createElement('li');
          li.className = 'showcase-failed';
          li.textContent = `Custom thumbnail failed: ${data.vimeoThumbnailError}`;
          vimeoShowcaseList.appendChild(li);
        }
        (data.vimeoShowcaseResults || []).forEach((r) => {
          const showcase = state.vimeoShowcases.find((s) => String(s.id) === String(r.showcaseId));
          const label = showcase ? showcase.name : r.showcaseId;
          const li = document.createElement('li');
          li.className = r.ok ? 'showcase-ok' : 'showcase-failed';
          li.textContent = r.ok ? `Added to showcase ${label}` : `Showcase ${label} failed: ${r.error}`;
          vimeoShowcaseList.appendChild(li);
        });
      }

      if (data.status === 'publish-error') {
        vimeoStatusLabel.textContent = 'Vimeo publish failed';
        vimeoError.hidden = false;
        vimeoError.textContent = data.error || 'Unknown error publishing to Vimeo.';
      }

      if (data.scStatus === 'publishing') {
        const pct = Math.round((data.scProgress || 0) * 100);
        soundcloudProgressFill.style.width = pct + '%';
        soundcloudStatusLabel.textContent = `Publishing to SoundCloud… ${pct}%`;
      }

      if (data.scStatus === 'published') {
        soundcloudProgressFill.style.width = '100%';
        soundcloudStatusLabel.textContent = 'Published to SoundCloud';
        soundcloudResult.hidden = false;
        soundcloudResultLink.href = data.scUrl;
        soundcloudResultLink.textContent = data.scUrl;
        soundcloudPlaylistList.innerHTML = '';
        (data.scPlaylistResults || []).forEach((r) => {
          const playlist = state.soundcloudPlaylists.find((p) => String(p.id) === String(r.playlistId));
          const label = playlist ? playlist.name : r.playlistId;
          const li = document.createElement('li');
          li.className = r.ok ? 'showcase-ok' : 'showcase-failed';
          li.textContent = r.ok ? `Added to playlist ${label}` : `Playlist ${label} failed: ${r.error}`;
          soundcloudPlaylistList.appendChild(li);
        });
      }

      if (data.scStatus === 'error') {
        soundcloudStatusLabel.textContent = 'SoundCloud publish failed';
        soundcloudError.hidden = false;
        soundcloudError.textContent = data.scError || 'Unknown error publishing to SoundCloud.';
      }

      // The server flags the last frame it's going to send (see streamDone in /api/progress) and
      // ends the stream right after, so that's what decides when to close and reset the form -
      // rather than re-deriving it here from the individual statuses. Both sides used to work
      // that out independently, and any disagreement (say a Vimeo token cleared mid-render, so
      // the server stops expecting a publish the client is still waiting on) left this holding a
      // stream the server had already closed - which EventSource then quietly reconnects to
      // every few seconds indefinitely, with the UI stuck on "Rendering…".
      if (data.streamDone) {
        source.close();
        // showError() has already announced a failed render (and its own notification) - don't
        // follow it with a "Render complete" that contradicts it.
        if (data.status !== 'error') {
          notifyIfHidden('Render complete', `${computeOutputName()} is done.`);
        }
        // Snapshot the video this render just used, before finishRenderCycle() below clears
        // the active editing state - Re-Edit restores from this to jump straight back into
        // trimming the same file without a re-upload. Worth doing on a failed render too: a
        // bad setting (too long a crossfade, say) is exactly when you want to jump back in
        // without re-uploading the source.
        state.lastVideoJobId = state.videoJobId;
        state.lastVideoFile = state.videoFile;
        state.lastVideoDuration = state.videoDuration;
        finishRenderCycle();
        startOverSection.hidden = false;
        reEditBtn.hidden = false;
      }
    };
    source.onerror = () => {
      source.close();
      if (progressFill.style.width !== '100%') {
        showError('Lost connection to the server while rendering. Check the server logs.');
      }
    };
  });
})();
