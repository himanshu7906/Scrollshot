/* Window Utility — selection overlay for region drag and element picking. */
(() => {
  if (window.__wuOverlay) return;
  window.__wuOverlay = true;

  const api = globalThis.browser ?? globalThis.chrome;
  const ROOT_ID = 'wu-overlay-root';

  let state = null;

  function teardown() {
    const root = document.getElementById(ROOT_ID);
    if (root) root.remove();
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('mousedown', onMouseDown, true);
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mouseup', onMouseUp, true);
    document.removeEventListener('click', swallowClick, true);
    state = null;
  }

  function build(mode) {
    teardown();
    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.dataset.mode = mode;
    root.innerHTML = `
      <div class="wu-dim"></div>
      <div class="wu-box" hidden></div>
      <div class="wu-size" hidden></div>
      <div class="wu-hint">
        <strong>${mode === 'region' ? 'Drag to select an area' : 'Click the element to capture'}</strong>
        <span>Esc to cancel</span>
      </div>`;
    document.documentElement.appendChild(root);

    state = { mode, root, dragging: false, start: null, rect: null, target: null };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('click', swallowClick, true);
  }

  function box() { return state.root.querySelector('.wu-box'); }
  function label() { return state.root.querySelector('.wu-size'); }

  function paint(rect) {
    const b = box();
    b.hidden = false;
    b.style.left = `${rect.x}px`;
    b.style.top = `${rect.y}px`;
    b.style.width = `${rect.width}px`;
    b.style.height = `${rect.height}px`;

    const l = label();
    l.hidden = false;
    l.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
    l.style.left = `${rect.x}px`;
    l.style.top = `${Math.max(0, rect.y - 26)}px`;
  }

  function elementUnder(x, y) {
    const stack = document.elementsFromPoint(x, y);
    return stack.find((el) => el.id !== ROOT_ID && !el.closest(`#${ROOT_ID}`)) || null;
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      teardown();
    }
  }

  function swallowClick(event) {
    if (!state) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function onMouseDown(event) {
    if (!state || state.mode !== 'region' || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    state.dragging = true;
    state.start = { x: event.clientX, y: event.clientY };
  }

  function onMouseMove(event) {
    if (!state) return;

    if (state.mode === 'element') {
      const el = elementUnder(event.clientX, event.clientY);
      state.target = el;
      if (!el) return;
      const r = el.getBoundingClientRect();
      paint({ x: r.left, y: r.top, width: r.width, height: r.height });
      return;
    }

    if (!state.dragging) return;
    const x = Math.min(state.start.x, event.clientX);
    const y = Math.min(state.start.y, event.clientY);
    const width = Math.abs(event.clientX - state.start.x);
    const height = Math.abs(event.clientY - state.start.y);
    state.rect = { x, y, width, height };
    paint(state.rect);
  }

  function onMouseUp(event) {
    if (!state) return;
    event.preventDefault();
    event.stopPropagation();

    if (state.mode === 'element') {
      const el = state.target || elementUnder(event.clientX, event.clientY);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const position = window.getComputedStyle(el).position;
      const pinned = position === 'fixed' || position === 'sticky';
      const request = pinned
        ? { mode: 'region', rect: { x: r.left, y: r.top, width: r.width, height: r.height } }
        : {
            mode: 'element',
            rect: {
              x: r.left + window.scrollX,
              y: r.top + window.scrollY,
              width: r.width,
              height: r.height
            }
          };
      if (r.width < 1 || r.height < 1) { teardown(); return; }
      finish(request);
      return;
    }

    if (!state.dragging) return;
    const rect = state.rect;
    if (!rect || rect.width < 4 || rect.height < 4) { teardown(); return; }
    finish({ mode: 'region', rect });
  }

  async function finish(request) {
    const dpr = window.devicePixelRatio || 1;
    const settleMs = state && state.settleMs ? state.settleMs : 120;
    teardown();

    /* Let the overlay disappear from the rendered frame before capturing. */
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const result = await new Promise((resolve) => {
      const port = api.runtime.connect({ name: 'capture' });
      port.onMessage.addListener((message) => {
        if (message.type === 'done' || message.type === 'error') {
          resolve(message);
          port.disconnect();
        }
      });
      port.postMessage({ ...request, dpr, settleMs, hideFixed: true });
    });

    if (result.type === 'error') {
      notify(`Capture failed: ${result.message}`);
      return;
    }

    const copied = await copyImage(result.dataUrl);
    if (copied) {
      notify('Screenshot copied to clipboard');
    } else {
      api.runtime.sendMessage({
        type: 'open-preview',
        dataUrl: result.dataUrl,
        width: result.width,
        height: result.height,
        note: 'This page blocked clipboard access — copy or save the image here.'
      });
    }
  }

  async function copyImage(dataUrl) {
    try {
      if (!navigator.clipboard || !window.ClipboardItem) return false;
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    } catch (err) {
      return false;
    }
  }

  function notify(text) {
    const node = document.createElement('div');
    node.className = 'wu-toast';
    node.textContent = text;
    document.documentElement.appendChild(node);
    setTimeout(() => node.remove(), 2400);
  }

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'start-overlay') {
      build(message.mode);
      if (state) state.settleMs = message.settleMs;
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });
})();
