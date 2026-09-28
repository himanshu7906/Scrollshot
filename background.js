/* Window Utility — Screenshot
 * Background capture engine. Runs as an MV3 service worker in Chrome/Edge and
 * as a background script in Firefox. Only APIs available in both are used.
 */

const api = globalThis.browser ?? globalThis.chrome;

/* Chrome enforces MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND = 2. */
const CAPTURE_INTERVAL_MS = 550;
/* Canvas limits: keep well inside the per-browser maximums. */
const MAX_DIMENSION = 16384;
const MAX_AREA = 100e6;

let lastCaptureAt = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- capturing */

async function captureVisible(windowId) {
  const wait = CAPTURE_INTERVAL_MS - (Date.now() - lastCaptureAt);
  if (wait > 0) await sleep(wait);

  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const dataUrl = await api.tabs.captureVisibleTab(windowId, { format: 'png' });
      lastCaptureAt = Date.now();
      if (!dataUrl) throw new Error('Empty capture');
      return dataUrl;
    } catch (err) {
      lastError = err;
      await sleep(600 * (attempt + 1));
    }
  }
  throw new Error(`Could not capture this tab: ${lastError && lastError.message ? lastError.message : lastError}`);
}

async function toBitmap(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  return createImageBitmap(blob);
}

function arrayBufferToDataUrl(buffer, mime) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

async function canvasToDataUrl(canvas) {
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return arrayBufferToDataUrl(await blob.arrayBuffer(), 'image/png');
}

function fitScale(width, height) {
  let scale = 1;
  const longest = Math.max(width, height);
  if (longest > MAX_DIMENSION) scale = MAX_DIMENSION / longest;
  if (width * scale * height * scale > MAX_AREA) {
    scale = Math.min(scale, Math.sqrt(MAX_AREA / (width * height)));
  }
  return scale;
}

/* --------------------------------------------------------- content plumbing */

async function ensurePageScript(tabId) {
  try {
    await api.scripting.executeScript({ target: { tabId }, files: ['content/page.js'] });
  } catch (err) {
    throw new Error(
      'This page does not allow extensions to run (browser settings pages, the extension store and PDF viewers are off limits).'
    );
  }
}

function ask(tabId, message) {
  return api.tabs.sendMessage(tabId, message);
}

/* ------------------------------------------------------------- capture modes */

async function captureViewport(tab) {
  const dataUrl = await captureVisible(tab.windowId);
  const bmp = await toBitmap(dataUrl);
  return { dataUrl, width: bmp.width, height: bmp.height, scale: 1 };
}

/* Firefox can grab the whole page in one shot, outside the viewport included. */
async function captureFullPageNative(tab, metrics) {
  if (typeof api.tabs.captureTab !== 'function') return null;
  try {
    const dataUrl = await api.tabs.captureTab(tab.id, {
      format: 'png',
      rect: { x: 0, y: 0, width: metrics.width, height: metrics.height },
      scale: metrics.dpr
    });
    if (!dataUrl) return null;
    const bmp = await toBitmap(dataUrl);
    return { dataUrl, width: bmp.width, height: bmp.height, scale: 1 };
  } catch (err) {
    return null;
  }
}

async function captureFullPage(tab, options, report) {
  await ensurePageScript(tab.id);
  const metrics = await ask(tab.id, { type: 'metrics' });

  const native = await captureFullPageNative(tab, metrics);
  if (native) {
    report(1, 1);
    return native;
  }

  const dpr = metrics.dpr;
  const scale = fitScale(metrics.width * dpr, metrics.height * dpr);
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(metrics.width * dpr * scale)),
    Math.max(1, Math.round(metrics.height * dpr * scale))
  );
  const ctx = canvas.getContext('2d');

  const stepX = Math.max(1, metrics.viewportW);
  const stepY = Math.max(1, metrics.viewportH);
  const cols = Math.max(1, Math.ceil(metrics.width / stepX));
  const rows = Math.max(1, Math.ceil(metrics.height / stepY));
  const total = cols * rows;

  await ask(tab.id, { type: 'prepare' });
  let done = 0;

  try {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const pos = await ask(tab.id, {
          type: 'scrollTo',
          x: col * stepX,
          y: row * stepY,
          delay: options.settleMs
        });

        const tileUrl = await captureVisible(tab.windowId);
        const bmp = await toBitmap(tileUrl);

        ctx.drawImage(
          bmp,
          Math.round(pos.x * dpr * scale),
          Math.round(pos.y * dpr * scale),
          bmp.width * scale,
          bmp.height * scale
        );
        bmp.close();

        /* Sticky headers are kept for the first tile, then hidden so they do
         * not repeat down the stitched image. */
        if (done === 0 && options.hideFixed !== false) {
          await ask(tab.id, { type: 'hideFixed' });
        }
        report(++done, total);
      }
    }
  } finally {
    try { await ask(tab.id, { type: 'restore' }); } catch (_) { /* tab may be gone */ }
  }

  return {
    dataUrl: await canvasToDataUrl(canvas),
    width: canvas.width,
    height: canvas.height,
    scale
  };
}

async function cropDataUrl(dataUrl, rect, dpr, sourceScale = 1) {
  const bmp = await toBitmap(dataUrl);
  const f = dpr * sourceScale;
  const sx = Math.max(0, Math.round(rect.x * f));
  const sy = Math.max(0, Math.round(rect.y * f));
  const sw = Math.max(1, Math.min(Math.round(rect.width * f), bmp.width - sx));
  const sh = Math.max(1, Math.min(Math.round(rect.height * f), bmp.height - sy));

  const canvas = new OffscreenCanvas(sw, sh);
  canvas.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  bmp.close();
  return { dataUrl: await canvasToDataUrl(canvas), width: sw, height: sh, scale: 1 };
}

/* Region: crop out of a single viewport grab (rect is in viewport coordinates). */
async function captureRegion(tab, rect, dpr) {
  const dataUrl = await captureVisible(tab.windowId);
  return cropDataUrl(dataUrl, rect, dpr);
}

/* Element: grab the whole page, then crop by document coordinates, so elements
 * taller than the viewport come out complete. */
async function captureElement(tab, rect, options, report) {
  const page = await captureFullPage(tab, options, report);
  const metrics = await ask(tab.id, { type: 'metrics' });
  return cropDataUrl(page.dataUrl, rect, metrics.dpr, page.scale);
}

/* ------------------------------------------------------------------ dispatch */

async function activeTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab.');
  return tab;
}

async function runCapture(request, report) {
  const tab = request.tabId ? await api.tabs.get(request.tabId) : await activeTab();
  const options = {
    settleMs: Number(request.settleMs) || 120,
    hideFixed: request.hideFixed !== false
  };

  switch (request.mode) {
    case 'viewport':
      return captureViewport(tab);
    case 'fullpage':
      return captureFullPage(tab, options, report);
    case 'region':
      return captureRegion(tab, request.rect, request.dpr || 1);
    case 'element':
      return captureElement(tab, request.rect, options, report);
    default:
      throw new Error(`Unknown capture mode: ${request.mode}`);
  }
}

/* Long-lived port: keeps the service worker alive for the whole capture and
 * streams progress back to whoever asked. */
api.runtime.onConnect.addListener((port) => {
  if (port.name !== 'capture') return;

  port.onMessage.addListener(async (request) => {
    const report = (done, total) => {
      try { port.postMessage({ type: 'progress', done, total }); } catch (_) {}
    };
    try {
      const result = await runCapture(request, report);
      port.postMessage({ type: 'done', ...result });
    } catch (err) {
      port.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
    }
  });
});

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'start-overlay') {
        const tab = await activeTab();
        await api.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content/overlay.css'] });
        await api.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/overlay.js'] });
        await ask(tab.id, { type: 'start-overlay', mode: message.mode, settleMs: message.settleMs });
        sendResponse({ ok: true });
        return;
      }

      if (message.type === 'open-preview') {
        await openPreview(message.dataUrl, message.width, message.height, message.note);
        sendResponse({ ok: true });
        return;
      }

      sendResponse({ ok: false, error: 'Unknown message' });
    } catch (err) {
      sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
    }
  })();
  return true;
});

/* -------------------------------------------------------------- preview tab */

async function openPreview(dataUrl, width, height, note) {
  const store = api.storage.session || api.storage.local;
  await store.set({ preview: { dataUrl, width, height, note, at: Date.now() } });
  await api.tabs.create({ url: api.runtime.getURL('preview/preview.html') });
}

/* ------------------------------------------------------ keyboard shortcuts */

if (api.commands && api.commands.onCommand) {
  api.commands.onCommand.addListener(async (command) => {
    const mode = command === 'capture-fullpage' ? 'fullpage' : 'viewport';
    try {
      const result = await runCapture({ mode }, () => {});
      const tab = await activeTab();
      let copied = false;
      try {
        await ensurePageScript(tab.id);
        const res = await ask(tab.id, { type: 'copy', dataUrl: result.dataUrl });
        copied = !!(res && res.ok);
      } catch (_) {}
      if (!copied) {
        await openPreview(result.dataUrl, result.width, result.height, 'Clipboard was not available from the page — copy it here.');
      } else {
        try { await ask(tab.id, { type: 'toast', text: 'Screenshot copied to clipboard' }); } catch (_) {}
      }
    } catch (err) {
      console.warn('[Window Utility]', err);
    }
  });
}
