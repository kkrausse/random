// The page's only code: import the scene, build it, show it. No build step.
// A scene module's default export is one figure's .excs text (diagram.js render()), or rows of figures
// ([[a, b], [c]]: a and b side by side, c under them) for one big canvas. It may export `title`.
import "../scripts/excs.js"; // (new-diagram.sh copies it beside this file and rewrites this line) sets globalThis.EXCS (text -> Excalidraw elements)
import { canvas } from "./diagram.js";

const msg = (/** @type {string} */ t) => { const m = document.getElementById("msg"); if (m) m.textContent = t; };
try {
  const src = new URLSearchParams(location.search).get("scene") ?? "./scene.js";
  const mod = await import(new URL(src, location.href).href);
  const rows = typeof mod.default === "string" ? [[mod.default]] : mod.default;
  if (mod.title) document.title = mod.title;
  const elements = canvas(rows.map((/** @type {string[]} */ r) => r.map((t) => globalThis.EXCS.build(t).elements)));
  const [React, { createRoot }, { Excalidraw }] = await Promise.all([import("react"), import("react-dom/client"), import("@excalidraw/excalidraw")]);
  createRoot(/** @type {HTMLElement} */ (document.getElementById("root"))).render(React.createElement(Excalidraw, {
    viewModeEnabled: true,
    initialData: { elements, files: {}, appState: { viewBackgroundColor: "#ffffff" } },
    // start with the whole canvas in view; zoom into a figure from there
    excalidrawAPI: (/** @type {any} */ api) => setTimeout(() => api.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.97, animate: false }), 100),
  }));
} catch (e) {
  msg(String(/** @type {any} */ (e)?.stack ?? e));
  throw e;
}
