(() => {
  const state = { png: null, video: null };

  const dzPng = document.getElementById('dz-png');
  const dzVideo = document.getElementById('dz-video');
  const inputPng = document.getElementById('input-png');
  const inputVideo = document.getElementById('input-video');
  const renderBtn = document.getElementById('render-btn');
  const form = document.getElementById('render-form');

  const progressSection = document.getElementById('progress-section');
  const progressFill = document.getElementById('progress-fill');
  const progressLabel = document.getElementById('progress-label');

  const resultSection = document.getElementById('result-section');
  const resultPreview = document.getElementById('result-preview');
  const downloadLink = document.getElementById('download-link');

  const errorSection = document.getElementById('error-section');
  const errorMessage = document.getElementById('error-message');

  function setupDropzone(zone, input, kind) {
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
      if (file) selectFile(kind, file);
    });

    input.addEventListener('change', () => {
      if (input.files[0]) selectFile(kind, input.files[0]);
    });

    zone.querySelector('.dz-clear').addEventListener('click', (e) => {
      e.stopPropagation();
      clearFile(kind);
    });
  }

  function selectFile(kind, file) {
    state[kind] = file;
    const zone = kind === 'png' ? dzPng : dzVideo;
    zone.querySelector('.dz-empty').hidden = true;
    zone.querySelector('.dz-filled').hidden = false;

    const url = URL.createObjectURL(file);
    if (kind === 'png') {
      document.getElementById('png-preview').src = url;
      document.getElementById('png-filename').textContent = file.name;
    } else {
      document.getElementById('video-preview').src = url;
      document.getElementById('video-filename').textContent = file.name;
    }
    updateRenderButton();
  }

  function clearFile(kind) {
    state[kind] = null;
    const zone = kind === 'png' ? dzPng : dzVideo;
    zone.querySelector('.dz-empty').hidden = false;
    zone.querySelector('.dz-filled').hidden = true;
    (kind === 'png' ? inputPng : inputVideo).value = '';
    updateRenderButton();
  }

  function updateRenderButton() {
    const nameFilled = document.getElementById('outputName').value.trim().length > 0;
    renderBtn.disabled = !(state.png && state.video && nameFilled);
  }

  document.getElementById('outputName').addEventListener('input', updateRenderButton);

  setupDropzone(dzPng, inputPng, 'png');
  setupDropzone(dzVideo, inputVideo, 'video');

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
    progressSection.hidden = false;
    progressFill.style.width = '0%';
    progressLabel.textContent = 'Uploading files…';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.png || !state.video) return;

    resetPanels();
    renderBtn.disabled = true;
    renderBtn.textContent = 'Rendering…';

    const formData = new FormData();
    formData.append('png', state.png);
    formData.append('video', state.video);
    formData.append('startDuration', document.getElementById('startDuration').value);
    formData.append('endDuration', document.getElementById('endDuration').value);
    formData.append('transition', document.getElementById('transition').value);
    formData.append('fadeOut', document.getElementById('fadeOut').value);
    formData.append('outputName', document.getElementById('outputName').value.trim());

    let jobId;
    try {
      const res = await fetch('/api/render', { method: 'POST', body: formData });
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
      const pct = Math.round((data.progress || 0) * 100);
      progressFill.style.width = pct + '%';
      progressLabel.textContent = `Rendering… ${pct}%`;

      if (data.status === 'done') {
        source.close();
        progressSection.hidden = true;
        resultSection.hidden = false;
        const url = `/api/download/${jobId}`;
        resultPreview.src = url;
        downloadLink.href = url;
        downloadLink.download = document.getElementById('outputName').value.trim() + '.mp4';
        renderBtn.disabled = false;
        renderBtn.textContent = 'Render Video';
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
