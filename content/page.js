/* Window Utility — page helper.
 * Measures the document, drives scrolling during a stitched capture, hides
 * sticky furniture, and writes results to the clipboard from page context.
 */
(() => {
  if (window.__wuPageHelper) return;
  window.__wuPageHelper = true;

  const api = globalThis.browser ?? globalThis.chrome;
  let hiddenElements = [];
  let saved = null;

  function metrics() {
    const doc = document.documentElement;
    const body = document.body;
    const width = Math.max(
      doc.scrollWidth, doc.clientWidth, doc.offsetWidth,
      body ? body.scrollWidth : 0, body ? body.offsetWidth : 0
    );
    const height = Math.max(
      doc.scrollHeight, doc.clientHeight, doc.offsetHeight,
      body ? body.scrollHeight : 0, body ? body.offsetHeight : 0
    );
    return {
      width,
      height,
      viewportW: doc.clientWidth || window.innerWidth,
      viewportH: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
      scrollX: window.scrollX,
      scrollY: window.scrollY
    };
  }

  function prepare() {
    const doc = document.documentElement;
    saved = {
      x: window.scrollX,
      y: window.scrollY,
      scrollBehavior: doc.style.scrollBehavior,
      bodyScrollBehavior: document.body ? document.body.style.scrollBehavior : ''
    };
    doc.style.scrollBehavior = 'auto';
    if (document.body) document.body.style.scrollBehavior = 'auto';
    return { ok: true };
  }

  function hideFixed() {
    unhideAll();

    document.querySelectorAll('body *').forEach((el) => {
      if (el.id === 'wu-overlay-root' || el.closest('#wu-overlay-root')) return;
      const style = window.getComputedStyle(el);
      if (style.position !== 'fixed' && style.position !== 'sticky') return;
      if (style.visibility === 'hidden' || style.display === 'none') return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      hiddenElements.push({ el, previous: el.style.getPropertyValue('visibility') });
      el.style.setProperty('visibility', 'hidden', 'important');
    });
    return { hidden: hiddenElements.length };
  }

  function unhideAll() {
    hiddenElements.forEach((entry) => {
      entry.el.style.removeProperty('visibility');
      if (entry.previous) entry.el.style.setProperty('visibility', entry.previous);
    });
    hiddenElements = [];
  }

  function restore() {
    unhideAll();
    if (saved) {
      window.scrollTo(saved.x, saved.y);
      document.documentElement.style.scrollBehavior = saved.scrollBehavior;
      if (document.body) document.body.style.scrollBehavior = saved.bodyScrollBehavior;
      saved = null;
    }
    return { ok: true };
  }

  function scrollToPosition(x, y, delay) {
    window.scrollTo(x, y);
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        setTimeout(() => resolve({ x: window.scrollX, y: window.scrollY }), Math.max(0, delay || 0));
      });
    });
  }

  async function copyImage(dataUrl) {
    try {
      if (!navigator.clipboard || !window.ClipboardItem) return { ok: false, reason: 'unsupported' };
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err && err.message ? err.message : String(err) };
    }
  }

  function toast(text) {
    const node = document.createElement('div');
    node.textContent = text;
    node.setAttribute('style', [
      'position:fixed', 'z-index:2147483647', 'left:50%', 'top:24px',
      'transform:translateX(-50%)', 'padding:10px 16px', 'border-radius:10px',
      'background:rgba(17,17,20,.92)', 'color:#fff', 'font:500 13px/1.3 system-ui,sans-serif',
      'box-shadow:0 6px 24px rgba(0,0,0,.28)', 'pointer-events:none'
    ].join(';'));
    document.documentElement.appendChild(node);
    setTimeout(() => node.remove(), 2200);
    return { ok: true };
  }

  const HANDLED = ['metrics', 'prepare', 'hideFixed', 'restore', 'scrollTo', 'copy', 'toast'];

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !HANDLED.includes(message.type)) return false;
    (async () => {
      switch (message.type) {
        case 'metrics': return sendResponse(metrics());
        case 'prepare': return sendResponse(prepare());
        case 'hideFixed': return sendResponse(hideFixed());
        case 'restore': return sendResponse(restore());
        case 'scrollTo': return sendResponse(await scrollToPosition(message.x, message.y, message.delay));
        case 'copy': return sendResponse(await copyImage(message.dataUrl));
        case 'toast': return sendResponse(toast(message.text));
      }
    })();
    return true;
  });
})();
