# Scrollshot

**Scroll, stitch, copy.** A cross-browser (Manifest V3) extension that captures a web page four ways and puts the result straight on your clipboard.

| Mode | What it does |
|---|---|
| **Full page** | Scrolls the page, captures each viewport tile, stitches them into one tall image |
| **Viewport** | Grabs exactly what's on screen |
| **Region** | Drag a rectangle over the page |
| **Element** | Hover to highlight a node, click to capture it — including parts below the fold |

If a page blocks clipboard access (plain `http://`, or a restrictive permissions policy), a preview tab opens with **Copy** and **Save PNG** buttons.

## Install

**Chrome / Edge / Brave / Opera / Arc**

1. Open `chrome://extensions` (`edge://extensions`).
2. Turn on **Developer mode**.
3. **Load unpacked** → select this folder.

**Firefox**

1. Rename `manifest.json` → `manifest.chrome.json`, then `manifest.firefox.json` → `manifest.json`.
2. Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → pick `manifest.json`.
   (For a permanent install, zip the folder and submit it to AMO.)

**Safari** — run Apple's `xcrun safari-web-extension-converter <folder>` on the Chrome variant; the code uses only APIs Safari's WebExtension layer supports.

## The toolbar icon

Firefox and Safari read `icons/icon.svg` directly, so they show the logo out of the box. Chrome only accepts raster icons, which is why `manifest.json` ships without an icon entry (Chrome refuses to load an extension whose icon files are missing).

To give Chrome the logo:

1. Open `icons/make-icons.html` in your browser.
2. Click **Download all PNGs** — you get `icon-16/32/48/128.png`.
3. Move those four files into `icons/`.
4. Rename `manifest.chrome-with-icons.json` → `manifest.json` (keep the old one as a backup) and reload the extension.

## Keyboard shortcuts

- `Alt+Shift+P` — full page to clipboard
- `Alt+Shift+V` — viewport to clipboard

Rebind them at `chrome://extensions/shortcuts`.

## Options (in the popup)

- **Hide sticky headers while scrolling** — keeps fixed/sticky bars in the first tile only, so they don't repeat down a long capture.
- **Settle delay** — pause after each scroll before capturing. Raise it to 300–500 ms on pages with lazy-loaded images or scroll animations.

## How it works

- `background.js` is the capture engine: throttled `tabs.captureVisibleTab` (Chrome allows 2 calls/sec), stitching on an `OffscreenCanvas`, and cropping. On Firefox it first tries the one-shot `tabs.captureTab` with a full-page rect and only falls back to tiling if that fails.
- `content/page.js` measures the document, drives scrolling, hides sticky furniture, and restores the original scroll position afterwards.
- `content/overlay.js` draws the region selector and element picker, and removes itself from the frame before the capture fires.
- The popup and the overlay talk to the background over a long-lived port, which both streams progress and keeps the MV3 service worker alive for the whole capture.

## Known limits

- Browsers won't let any extension run on `chrome://`, `about:`, the extension stores, or the built-in PDF viewer.
- Very tall pages are downscaled to stay inside canvas limits (~16384 px on a side); the popup tells you the scale factor when that happens.
- Cross-origin iframes and DRM-protected video may render blank — a browser-level restriction, not a bug in the tiling.

## Assets and licence

The Scrollshot logo (`icons/icon.svg`) is original vector artwork drawn for this project — plain SVG shapes and gradients, no third-party images, no licensed fonts, no traced marks. It carries no external copyright obligations; use, edit and ship it freely. Same for the extension code.

Brand colours: `#7c4dff` → `#2f9dff` (page gradient), `#22c1ff` → `#6d4aff` (shutter gradient).
