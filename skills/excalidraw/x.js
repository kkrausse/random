// Diagrams published before the one-.js-file shell import { draw, ... } from ".../excalidraw-lib/x.js".
// lib/x.js is now a classic script that sets globals; load it and re-export them, or those pages stop rendering.
await new Promise((ok, fail) => {
  const s = document.createElement("script");
  s.src = new URL("lib/x.js", import.meta.url).href;
  s.onload = ok;
  s.onerror = () => fail(new Error(`cannot load ${s.src}`));
  document.head.append(s);
});
const w = /** @type {any} */ (window);
export const { draw, box, ellipse, diamond, text, line, pen, image, embed, row, col, at, frame, group, file, arrow } = w;
