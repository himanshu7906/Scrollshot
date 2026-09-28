const api = globalThis.browser ?? globalThis.chrome;

const shot = document.getElementById('shot');
const meta = document.getElementById('meta');
const note = document.getElementById('note');
const empty = document.getElementById('empty');
const copyButton = document.getElementById('copy');
const saveButton = document.getElementById('save');

let current = null;

(async function load() {
  const store = api.storage.session || api.storage.local;
  const { preview } = await store.get('preview');
  if (!preview || !preview.dataUrl) {
    empty.hidden = false;
    copyButton.disabled = true;
    saveButton.disabled = true;
    return;
  }
  current = preview;
  shot.src = preview.dataUrl;
  shot.hidden = false;
  meta.textContent = `${preview.width} × ${preview.height} px`;
  note.textContent = preview.note || '';
})();

copyButton.addEventListener('click', async () => {
  try {
    const blob = await (await fetch(current.dataUrl)).blob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    copyButton.textContent = 'Copied ✓';
    setTimeout(() => { copyButton.textContent = 'Copy to clipboard'; }, 1800);
  } catch (err) {
    note.textContent = `Clipboard failed: ${err.message}`;
  }
});

saveButton.addEventListener('click', () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const link = document.createElement('a');
  link.href = current.dataUrl;
  link.download = `screenshot-${stamp}.png`;
  link.click();
});
