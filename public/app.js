(() => {
  const state = {
    png: null,
    videoJobId: null,
    videoDuration: 0,
    candidates: [],
    vimeoConfigured: false,
  };

  const dzPng = document.getElementById('dz-png');
  const dzVideo = document.getElementById('dz-video');
  const inputPng = document.getElementById('input-png');
  const inputVideo = document.getElementById('input-video');
  const renderBtn = document.getElementById('render-btn');
  const form = document.getElementById('render-form');

  const videoUploadPct = document.getElementById('video-upload-pct');
  const videoUploadFill = document.getElementById('video-upload-fill');

  const progressSection = document.getElementById('progress-section');
  const progressFill = document.getElementById('progress-fill');
  const progressLabel = document.getElementById('progress-label');

  const resultSection = document.getElementById('result-section');
  const resultPreview = document.getElementById('result-preview');
  const downloadLink = document.getElementById('download-link');
  const downloadMp3Link = document.getElementById('download-mp3-link');

  const errorSection = document.getElementById('error-section');
  const errorMessage = document.getElementById('error-message');

  const vimeoStatusSection = document.getElementById('vimeo-status-section');
  const vimeoProgressFill = document.getElementById('vimeo-progress-fill');
  const vimeoStatusLabel = document.getElementById('vimeo-status-label');
  const vimeoResult = document.getElementById('vimeo-result');
  const vimeoResultLink = document.getElementById('vimeo-result-link');
  const vimeoShowcaseList = document.getElementById('vimeo-showcase-list');
  const vimeoError = document.getElementById('vimeo-error');

  const vimeoConfirmOverlay = document.getElementById('vimeo-confirm-overlay');
  const vimeoDescriptionInput = document.getElementById('vimeo-description');
  const vimeoShowcaseChecks = document.getElementById('vimeo-showcase-checks');
  const vimeoCancelBtn = document.getElementById('vimeo-cancel-btn');
  const renderOnlyBtn = document.getElementById('render-only-btn');
  const renderPublishBtn = document.getElementById('render-publish-btn');

  fetch('/api/vimeo-status')
    .then((res) => res.json())
    .then((data) => {
      state.vimeoConfigured = !!data.configured;
    })
    .catch(() => {
      state.vimeoConfigured = false;
    });

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
      checkbox.checked = true; // all showcases selected by default, matching the original always-add-to-all behavior
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
      vimeoDescriptionInput.value = 'Core Text: TBD';
      renderVimeoShowcaseChecks();
      vimeoConfirmOverlay.hidden = false;
      vimeoDescriptionInput.focus();
      // Select just "TBD" so typing immediately replaces it, leaving "Core Text: " intact.
      vimeoDescriptionInput.setSelectionRange(11, 14);

      const onCancel = () => {
        cleanup();
        resolve({ cancelled: true });
      };
      const onRenderOnly = () => {
        cleanup();
        resolve({ publish: false, description: '', showcaseIds: [] });
      };
      const onRenderPublish = () => {
        const showcaseIds = Array.from(vimeoShowcaseChecks.querySelectorAll('input[type="checkbox"]:checked')).map((c) => c.value);
        cleanup();
        resolve({ publish: true, description: vimeoDescriptionInput.value.trim(), showcaseIds });
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

  const normalizeAudioCheckbox = document.getElementById('normalizeAudio');
  const targetLufsSelect = document.getElementById('targetLufs');
  normalizeAudioCheckbox.addEventListener('change', () => {
    targetLufsSelect.disabled = !normalizeAudioCheckbox.checked;
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
      if (typeof s.normalize === 'boolean') {
        normalizeAudioCheckbox.checked = s.normalize;
        targetLufsSelect.disabled = !s.normalize;
      }
      if (typeof s.targetLufs === 'number' && document.querySelector(`#targetLufs option[value="${s.targetLufs}"]`)) {
        targetLufsSelect.value = String(s.targetLufs);
      }
      if (typeof s.exportMp3 === 'boolean') document.getElementById('exportMp3').checked = s.exportMp3;
    } catch {
      // Non-critical - just leave the HTML defaults in place.
    }
  })();

  // --- Trim panel ---
  const trimPanel = document.getElementById('trim-panel');
  const trimStartHandle = document.getElementById('trim-start-handle');
  const trimEndHandle = document.getElementById('trim-end-handle');
  const trimRangeFill = document.getElementById('trim-range-fill');
  const trimStartLabel = document.getElementById('trim-start-label');
  const trimEndLabel = document.getElementById('trim-end-label');
  const trimDurationLabel = document.getElementById('trim-duration-label');
  const previewStartBtn = document.getElementById('preview-start-btn');
  const previewEndBtn = document.getElementById('preview-end-btn');
  const playPauseBtn = document.getElementById('play-pause-btn');
  const detectSermonBtn = document.getElementById('detect-sermon-btn');
  const detectProgress = document.getElementById('detect-progress');
  const detectProgressFill = document.getElementById('detect-progress-fill');
  const detectProgressLabel = document.getElementById('detect-progress-label');
  const candidateList = document.getElementById('candidate-list');
  const candidateChips = document.getElementById('candidate-chips');
  const detectError = document.getElementById('detect-error');
  const videoPreview = document.getElementById('video-preview');

  function formatTime(seconds) {
    seconds = Math.max(0, Math.round(seconds));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
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
  }

  function setTrimRange(start, end) {
    trimStartHandle.value = start;
    trimEndHandle.value = end;
    updateTrimUI();
    scrubTo(start);
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

  function renderCandidateChips() {
    candidateChips.innerHTML = '';
    state.candidates.forEach((c, i) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'candidate-chip' + (i === 0 ? ' selected' : '');
      chip.textContent = `${formatTime(c.start)}–${formatTime(c.end)} (${formatTime(c.durationSec)})`;
      chip.addEventListener('click', () => {
        setTrimRange(c.start, c.end);
        candidateChips.querySelectorAll('.candidate-chip').forEach((el) => el.classList.remove('selected'));
        chip.classList.add('selected');
      });
      candidateChips.appendChild(chip);
    });
    candidateList.hidden = state.candidates.length === 0;
  }

  detectSermonBtn.addEventListener('click', async () => {
    if (!state.videoJobId) return;
    detectSermonBtn.disabled = true;
    detectError.hidden = true;
    candidateList.hidden = true;
    detectProgress.hidden = false;
    detectProgressFill.style.width = '0%';
    detectProgressLabel.textContent = 'Analyzing… this can take a while for long files.';

    try {
      const res = await fetch(`/api/analyze/${state.videoJobId}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start analysis.');
    } catch (err) {
      detectProgress.hidden = true;
      detectError.hidden = false;
      detectError.textContent = err.message;
      detectSermonBtn.disabled = false;
      return;
    }

    const source = new EventSource(`/api/progress/${state.videoJobId}`);
    source.onmessage = (evt) => {
      const data = JSON.parse(evt.data);
      if (data.status === 'error') {
        source.close();
        detectProgress.hidden = true;
        detectError.hidden = false;
        detectError.textContent = data.error || 'Analysis failed.';
        detectSermonBtn.disabled = false;
        return;
      }
      const pct = Math.round((data.progress || 0) * 100);
      detectProgressFill.style.width = pct + '%';
      detectProgressLabel.textContent = `Analyzing… ${pct}%`;

      if (data.status === 'analyzed') {
        source.close();
        detectProgress.hidden = true;
        detectSermonBtn.disabled = false;
        state.candidates = data.candidates || [];
        if (state.candidates.length) {
          setTrimRange(state.candidates[0].start, state.candidates[0].end);
          renderCandidateChips();
        } else {
          detectError.hidden = false;
          detectError.textContent = 'Could not confidently detect a sermon segment - trim manually using the slider above.';
        }
      }
    };
    source.onerror = () => {
      source.close();
      if (detectProgress.hidden === false) {
        detectProgress.hidden = true;
        detectError.hidden = false;
        detectError.textContent = 'Lost connection to the server during analysis.';
        detectSermonBtn.disabled = false;
      }
    };
  });

  // --- Dropzones ---
  function setupDropzone(zone, input, onFile) {
    zone.addEventListener('click', (e) => {
      if (e.target.closest('.dz-clear')) return;
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

  // PNG dropzone (client-side only, uploaded together with the render request)
  setupDropzone(dzPng, inputPng, (file) => {
    state.png = file;
    showDzState(dzPng, 'dz-filled');
    document.getElementById('png-preview').src = URL.createObjectURL(file);
    document.getElementById('png-filename').textContent = file.name;
    updateRenderButton();
  });
  dzPng.querySelector('.dz-clear').addEventListener('dz-clear-click', () => {
    state.png = null;
    showDzState(dzPng, 'dz-empty');
    inputPng.value = '';
    updateRenderButton();
  });

  // Video dropzone: uploads immediately so it can be analyzed/trimmed before rendering.
  function uploadVideo(file) {
    showDzState(dzVideo, 'dz-uploading');
    videoUploadFill.style.width = '0%';
    videoUploadPct.textContent = '0%';
    errorSection.hidden = true;

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
        errorSection.hidden = false;
        errorMessage.textContent = data.error || 'Video upload failed.';
        return;
      }

      state.videoJobId = data.jobId;
      state.videoDuration = data.duration;
      state.candidates = [];

      showDzState(dzVideo, 'dz-filled');
      videoPreview.src = URL.createObjectURL(file);
      updatePlayPauseLabel();
      document.getElementById('video-filename').textContent = `${file.name} (${formatTime(data.duration)})`;

      trimStartHandle.min = 0;
      trimStartHandle.max = data.duration;
      trimStartHandle.step = 0.1;
      trimEndHandle.min = 0;
      trimEndHandle.max = data.duration;
      trimEndHandle.step = 0.1;
      setTrimRange(0, data.duration);
      trimPanel.hidden = false;
      candidateList.hidden = true;
      detectError.hidden = true;

      updateRenderButton();
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
    state.videoDuration = 0;
    state.candidates = [];
    showDzState(dzVideo, 'dz-empty');
    inputVideo.value = '';
    trimPanel.hidden = true;
    updateRenderButton();
  });

  function updateRenderButton() {
    const nameFilled = document.getElementById('outputName').value.trim().length > 0;
    renderBtn.disabled = !(state.videoJobId && state.png && nameFilled);
  }

  document.getElementById('outputName').addEventListener('input', updateRenderButton);

  function showError(message) {
    errorSection.hidden = false;
    errorMessage.textContent = message;
    progressSection.hidden = true;
    renderBtn.disabled = false;
    renderBtn.textContent = 'Render Video';
  }

  function resetPanels() {
    errorSection.hidden = true;
    resultSection.hidden = true;
    downloadMp3Link.hidden = true;
    vimeoStatusSection.hidden = true;
    vimeoResult.hidden = true;
    vimeoError.hidden = true;
    progressSection.hidden = false;
    progressFill.style.width = '0%';
    progressLabel.textContent = 'Uploading files…';
  }

  function finishRenderCycle() {
    renderBtn.disabled = false;
    renderBtn.textContent = 'Render Video';
    // The server deletes the uploaded video after a successful render, so
    // reset the dropzone/trim panel - a fresh render needs a fresh upload.
    state.videoJobId = null;
    state.videoDuration = 0;
    state.candidates = [];
    showDzState(dzVideo, 'dz-empty');
    inputVideo.value = '';
    trimPanel.hidden = true;
    updateRenderButton();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.videoJobId || !state.png) return;

    // Confirmed up front, before rendering even starts, so publishing can run automatically
    // once the render finishes with no further approval needed - but it's always a fresh,
    // deliberate choice, never remembered from a previous render.
    const vimeoChoice = state.vimeoConfigured
      ? await confirmVimeoPublish()
      : { publish: false, description: '', showcaseIds: [] };
    if (vimeoChoice.cancelled) return; // back out entirely - no render, nothing changes

    const { publish: publishToVimeo, description: vimeoDescription, showcaseIds: vimeoShowcaseIds } = vimeoChoice;

    resetPanels();
    renderBtn.disabled = true;
    renderBtn.textContent = 'Rendering…';

    const formData = new FormData();
    formData.append('png', state.png);
    formData.append('startDuration', document.getElementById('startDuration').value);
    formData.append('endDuration', document.getElementById('endDuration').value);
    formData.append('transition', document.getElementById('transition').value);
    formData.append('fadeOut', document.getElementById('fadeOut').value);
    formData.append('outputName', document.getElementById('outputName').value.trim());
    formData.append('crossfadeAudio', document.getElementById('crossfadeAudio').checked);
    formData.append('normalizeAudio', normalizeAudioCheckbox.checked);
    formData.append('targetLufs', targetLufsSelect.value);
    formData.append('exportMp3', document.getElementById('exportMp3').checked);
    formData.append('trimStart', trimStartHandle.value);
    formData.append('trimEnd', trimEndHandle.value);
    formData.append('publishToVimeo', publishToVimeo);
    formData.append('vimeoDescription', vimeoDescription);
    formData.append('vimeoShowcaseIds', vimeoShowcaseIds.join(','));

    let jobId;
    try {
      const res = await fetch(`/api/render/${state.videoJobId}`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Render request failed.');
      jobId = data.jobId;
    } catch (err) {
      showError(err.message);
      return;
    }

    progressLabel.textContent = 'Rendering…';
    const source = new EventSource(`/api/progress/${jobId}`);
    source.onmessage = (evt) => {
      const data = JSON.parse(evt.data);

      if (data.status === 'error') {
        source.close();
        showError(data.error || 'Rendering failed.');
        return;
      }

      if (data.status === 'rendering') {
        const pct = Math.round((data.progress || 0) * 100);
        progressFill.style.width = pct + '%';
        progressLabel.textContent = `Rendering… ${pct}%`;
        return;
      }

      if (data.status === 'done') {
        progressSection.hidden = true;
        resultSection.hidden = false;
        const outputName = document.getElementById('outputName').value.trim();
        const url = `/api/download/${jobId}`;
        resultPreview.src = url;
        downloadLink.href = url;
        downloadLink.download = outputName + '.mp4';

        if (data.hasMp3) {
          downloadMp3Link.href = `/api/download/${jobId}/mp3`;
          downloadMp3Link.download = outputName + '.mp3';
          downloadMp3Link.hidden = false;
        } else {
          downloadMp3Link.hidden = true;
        }

        if (publishToVimeo) {
          vimeoStatusSection.hidden = false;
          vimeoProgressFill.style.width = '0%';
          vimeoStatusLabel.textContent = 'Publishing to Vimeo…';
        } else {
          source.close();
          finishRenderCycle();
        }
        return;
      }

      if (data.status === 'publishing') {
        const pct = Math.round((data.progress || 0) * 100);
        vimeoProgressFill.style.width = pct + '%';
        vimeoStatusLabel.textContent = `Publishing to Vimeo… ${pct}%`;
        return;
      }

      if (data.status === 'published') {
        source.close();
        vimeoProgressFill.style.width = '100%';
        vimeoStatusLabel.textContent = 'Published to Vimeo';
        vimeoResult.hidden = false;
        vimeoResultLink.href = data.vimeoUrl;
        vimeoResultLink.textContent = data.vimeoUrl;
        vimeoShowcaseList.innerHTML = '';
        (data.vimeoShowcaseResults || []).forEach((r) => {
          const li = document.createElement('li');
          li.className = r.ok ? 'showcase-ok' : 'showcase-failed';
          li.textContent = r.ok ? `Added to showcase ${r.showcaseId}` : `Showcase ${r.showcaseId} failed: ${r.error}`;
          vimeoShowcaseList.appendChild(li);
        });
        finishRenderCycle();
        return;
      }

      if (data.status === 'publish-error') {
        source.close();
        vimeoStatusLabel.textContent = 'Vimeo publish failed';
        vimeoError.hidden = false;
        vimeoError.textContent = data.error || 'Unknown error publishing to Vimeo.';
        finishRenderCycle();
        return;
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
