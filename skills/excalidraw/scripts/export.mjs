// Faithful .excalidraw -> .svg + .png export. Drives installed Chrome headless
// (playwright-core, channel 'chrome'), loads @excalidraw/excalidraw from esm.sh,
// calls exportToSvg (fonts embedded), then rasterizes the SVG via <canvas>
// (element screenshots blank out past ~4k px; canvas does not).
// usage: node export.mjs scene.excalidraw [-o outBase] [--scale 2]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const args = process.argv.slice(2);
const input = args.find(a => !a.startsWith('-') && a.endsWith('.excalidraw'));
const outBase = args.includes('-o') ? args[args.indexOf('-o') + 1] : input.replace(/\.excalidraw$/, '');
const scale = args.includes('--scale') ? +args[args.indexOf('--scale') + 1] : 2;
if (!input) { console.error('usage: export.mjs scene.excalidraw [-o outBase] [--scale 2]'); process.exit(1); }
const scene = JSON.parse(fs.readFileSync(input, 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.setContent(`<!doctype html><html><body><script type="module">
  window.EXCALIDRAW_ASSET_PATH = "https://esm.sh/@excalidraw/excalidraw@0.18.0/dist/prod/";
  window.exc = await import("https://esm.sh/@excalidraw/excalidraw@0.18.0?deps=react@19.0.0,react-dom@19.0.0");
</script></body></html>`);
await page.waitForFunction(() => window.exc, null, { timeout: 120000 });
const svg = await page.evaluate(async ({ scene, scale }) => {
  const el = await window.exc.exportToSvg({
    elements: scene.elements, files: scene.files || {},
    appState: { ...scene.appState, exportBackground: true, viewBackgroundColor: '#ffffff',
      exportWithDarkMode: false, exportEmbedScene: false, exportScale: scale },
    exportPadding: 24,
  });
  return el.outerHTML;
}, { scene, scale });
fs.writeFileSync(outBase + '.svg', svg);
const m = svg.match(/width="([\d.]+)" height="([\d.]+)"/);
const w = Math.ceil(+m[1]), h = Math.ceil(+m[2]);
const dataUrl = await page.evaluate(async ({ svg, w, h }) => {
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await img.decode();
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/png');
}, { svg, w, h });
fs.writeFileSync(outBase + '.png', Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log(`${outBase}.svg\n${outBase}.png (${w}x${h})`);
await browser.close();
