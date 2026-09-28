const api = globalThis.browser ?? globalThis.chrome;

const statusBox = document.getElementById('status');
const statusText = document.getElementById('statusText');
const bar = statusBox.querySelector('.bar i');
const hideFixed = document.getElementById('hideFixed');
const settle = document.getElementById('settle');
const settleOut = document.getElementById('settleOut');
const openPreview = document.getElementById('openPreview');
const modeButtons = [...document.querySelectorAll('.mode')];

let lastResult = null;

/* --------------------------------------------------------------- settings */

(async function loadSettings() {
  const { settings } = await api.storage.local.get('settings');
  if (settings) {
    hideFixed.checked = settings.hideFixed !== false;
    settle.value = settings.settleMs ?? 120;
  }
  settleOut.textContent = `${settle.value} ms`;
})();

function saveSettings() {
  api.storage.local.set({
    settings: { hideFixed: hideFixed.checked, settleMs: Number(settle.value) }
  });
}

settle.addEventListener('input', () => { settleOut.textContent = `${settle.value} ms`; });
settle.addEventListener('change', saveSettings);
hideFixed.addEventListener('change', saveSettings);

/* ------------------------------------------------------------------- ui */

function setStatus(text, tone = '') {
  statusBox.hidden = false;
  statusBox.className = `status ${tone}`.trim();
  statusText.textContent = text;
}

function setProgress(done, total) {
  bar.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
}

function busy(isBusy) {
  modeButtons.forEach((button) => { button.disabled = isBusy; });
}

/* -------------------------------------------------------------- capture */

function runCapture(request) {
  return new Promise((resolve) => {
    const port = api.runtime.connect({ name: 'capture' });
    port.onMessage.addListener((message) => {
      if (message.type === 'progress') {
        setProgress(message.done, message.total);
        setStatus(message.total > 1 ? `Capturing tile ${message.done} of ${message.total}…` : 'Capturing…');
        return;
      }
      resolve(message);
      port.disconnect();
    });
    port.postMessage(request);
  });
}

async function copyToClipboard(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

async function stashPreview(result, note) {
  const store = api.storage.session || api.storage.local;
  await store.set({
    preview: { dataUrl: result.dataUrl, width: result.width, height: result.height, note, at: Date.now() }
  });
}

modeButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    const mode = button.dataset.mode;
    const options = { hideFixed: hideFixed.checked, settleMs: Number(settle.value) };

    /* Region and element need the page to itself — hand off and close. */
    if (mode === 'region' || mode === 'element') {
      const response = await api.runtime.sendMessage({ type: 'start-overlay', mode, ...options });
      if (response && response.ok === false) {
        setStatus(response.error || 'Could not start selection on this page.', 'error');
        return;
      }
      window.close();
      return;
    }

    busy(true);
    setProgress(0, 1);
    setStatus(mode === 'fullpage' ? 'Measuring page…' : 'Capturing…');

    const result = await runCapture({ mode, ...options });
    busy(false);

    if (result.type === 'error') {
      setProgress(0, 1);
      setStatus(result.message, 'error');
      return;
    }

    lastResult = result;
    setProgress(1, 1);
    openPreview.hidden = false;

    const size = `${result.width} × ${result.height} px`;
    const downscaled = result.scale && result.scale < 1
      ? ` (scaled to ${Math.round(result.scale * 100)}% to fit canvas limits)`
      : '';

    try {
      await copyToClipboard(result.dataUrl);
      await stashPreview(result, 'Copied to clipboard.');
      setStatus(`Copied to clipboard — ${size}${downscaled}`, 'ok');
    } catch (err) {
      await stashPreview(result, 'Clipboard was unavailable — copy or save it here.');
      setStatus(`Captured ${size}, but the clipboard was blocked. Use “Open last capture”.`, 'error');
    }
  });
});

openPreview.addEventListener('click', async () => {
  if (lastResult) await stashPreview(lastResult, '');
  await api.tabs.create({ url: api.runtime.getURL('preview/preview.html') });
  window.close();
});
