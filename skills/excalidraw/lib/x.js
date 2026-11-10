// x.js: draw a diagram as a script, shown in regular Excalidraw. The whole library: a diagram is one HTML file
//
//   <!doctype html><meta charset="utf-8"><title>my diagram</title>
//   <script type="module">
//   import { draw, box, text, row, col, arrow } from "https://raspberrypi.guineafowl-truck.ts.net/artifacts/excalidraw-lib/x.js";
//   draw([
//     col(40, box("q0", "query strip\n176 × 512"), row(30, box("a", "A", { bg: "blue" }), box("b", "B"))),
//     arrow("q0", "a", "361 × 1024"),
//   ]);
//   </script>
//
// Nodes know their size (monospace text estimate) and get placed by row / col; arrows bind to node ids and are drawn
// after everything is placed. draw() renders it; Ctrl/Cmd+C on the canvas copies the selection (or everything) as one
// line per element with its id, not Excalidraw's JSON.

/** @typedef {{ w: number, h: number, id?: string, place: (x: number, y: number) => any[] }} Node */

const FS = 16, PAD = 12, CW = 0.6, LH = 1.25;  // font size, box padding, monospace char width (em), line height
const COLORS = { blue: "#a5d8ff", green: "#b2f2bb", yellow: "#ffec99", red: "#ffc9c9", orange: "#ffd8a8",
  violet: "#d0bfff", gray: "#e9ecef", pink: "#fcc2d7", teal: "#96f2d7", white: "#ffffff" };
const INK = { blue: "#1971c2", green: "#2f9e44", red: "#e03131", orange: "#f08c00", violet: "#6741d9", gray: "#868e96", black: "#1e1e1e" };
const col_ = (/** @type {string | undefined} */ c, /** @type {Record<string, string>} */ map) => c && (map[c] ?? c);

/** text size in px, as drawn (monospace) */
const measure = (/** @type {string} */ s, fs = FS) => {
  const lines = String(s).split("\n");
  return { w: Math.max(...lines.map((l) => l.length)) * fs * CW, h: lines.length * fs * LH };
};

const style = (/** @type {any} */ o) => ({
  ...(o.bg && { backgroundColor: col_(o.bg, COLORS), fillStyle: "solid" }),
  ...(o.ink && { strokeColor: col_(o.ink, INK) }),
  ...(o.dashed && { strokeStyle: "dashed" }),
  ...(o.sw && { strokeWidth: o.sw }),
  roughness: 0, fontFamily: 3,
});

/** A shape with a label. o: { bg, ink, dashed, sw, fs, w, h, shape: "rectangle" | "ellipse" | "diamond", left } */
export function box(/** @type {string} */ id, text = "", /** @type {any} */ o = {}) {
  const fs = o.fs ?? FS, t = measure(text, fs);
  const w = o.w ?? Math.max(40, t.w + 2 * PAD), h = o.h ?? Math.max(30, t.h + 2 * PAD);
  return { id, w, h, place: (x, y) => [{ type: o.shape ?? "rectangle", id, x, y, width: w, height: h, roundness: o.shape ? null : { type: 3 }, ...style(o),
    customData: { x: 1 }, ...(text && { label: { text, fontSize: fs, fontFamily: 3, textAlign: o.left ? "left" : "center", ...(o.ink && { strokeColor: col_(o.ink, INK) }) } }) }] };
}

/** Free text. o: { fs, ink, left } */
export function text(/** @type {string} */ id, /** @type {string} */ s, /** @type {any} */ o = {}) {
  const fs = o.fs ?? FS, t = measure(s, fs);
  return { id, w: t.w, h: t.h, place: (x, y) => [{ type: "text", id, x, y, text: s, fontSize: fs, fontFamily: 3, textAlign: o.left === false ? "center" : "left",
    ...(o.ink && { strokeColor: col_(o.ink, INK) }), customData: { x: 1 } }] };
}

/** align: "start" | "center" | "end" across the stacking direction */
const stack = (/** @type {boolean} */ across, /** @type {number} */ g, /** @type {Node[]} */ kids, /** @type {string} */ align) => {
  kids = kids.flat().filter(Boolean);
  const main = across ? "w" : "h", cross = across ? "h" : "w";
  const len = kids.reduce((s, k) => s + k[main], 0) + g * Math.max(0, kids.length - 1), wide = Math.max(0, ...kids.map((k) => k[cross]));
  return { w: across ? len : wide, h: across ? wide : len, place: (x, y) => {
    let at = 0;
    return kids.flatMap((k) => {
      const off = align === "start" ? 0 : align === "end" ? wide - k[cross] : (wide - k[cross]) / 2;
      const r = across ? k.place(x + at, y + off) : k.place(x + off, y + at);
      at += k[main] + g;
      return r;
    });
  } };
};
/** Side by side, gap g. row(30, a, b) or row({ gap: 30, align: "start" }, a, b) */
export const row = (/** @type {number | { gap?: number, align?: string }} */ g, /** @type {Node[]} */ ...kids) =>
  typeof g === "number" ? stack(true, g, kids, "center") : stack(true, g.gap ?? 20, kids, g.align ?? "center");
/** Stacked, gap g. */
export const col = (/** @type {number | { gap?: number, align?: string }} */ g, /** @type {Node[]} */ ...kids) =>
  typeof g === "number" ? stack(false, g, kids, "center") : stack(false, g.gap ?? 20, kids, g.align ?? "center");

/** An arrow between two node ids, bound at both ends. o: { ink, dashed, sw, id, elbow } */
export function arrow(/** @type {string} */ from, /** @type {string} */ to, label = "", /** @type {any} */ o = {}) {
  return { arrow: true, from, to, label, o };
}

/** The scene's nodes and arrows -> element skeletons. Top-level nodes stack down the page. */
function build(/** @type {any[]} */ items) {
  items = items.flat(Infinity).filter(Boolean);
  const out = [];
  let y = 0;
  for (const n of items) if (!n.arrow) { out.push(...n.place(0, y)); y += n.h + 60; }
  const byId = new Map(out.map((e) => [e.id, e]));
  for (const a of items) if (a.arrow) {
    const s = byId.get(a.from), e = byId.get(a.to);
    if (!s || !e) throw new Error(`arrow ${a.from} -> ${a.to}: no element ${!s ? a.from : a.to}`);
    // from edge to edge along the line between the two centres (4 px off each edge)
    const c = (/** @type {any} */ el) => [el.x + (el.width ?? 0) / 2, el.y + (el.height ?? 0) / 2];
    const [cx, cy] = c(s), [dx, dy] = c(e), lx = dx - cx, ly = dy - cy, len = Math.hypot(lx, ly) || 1;
    const edge = (/** @type {any} */ el) => Math.min((el.width ?? 0) / 2 / (Math.abs(lx) || 1e-9), (el.height ?? 0) / 2 / (Math.abs(ly) || 1e-9)) + 4 / len;
    const t0 = edge(s), t1 = 1 - edge(e);
    const sx = cx + lx * t0, sy = cy + ly * t0, ex = cx + lx * t1, ey = cy + ly * t1;
    out.push({ type: "arrow", id: a.o.id ?? `${a.from}>${a.to}`, x: sx, y: sy, width: ex - sx, height: ey - sy,
      points: [[0, 0], [ex - sx, ey - sy]], start: { id: a.from }, end: { id: a.to }, ...style(a.o),
      ...(a.o.elbow && { elbowed: true }), ...(a.label && { label: { text: a.label, fontSize: 14, fontFamily: 3 } }), customData: { x: 1 } });
  }
  return out;
}

const V = "0.18.0", ESM = "https://esm.sh/";
/** @type {any} */ let api;

/** Render the diagram into the page (the page needs nothing but this call). */
export async function draw(/** @type {any[]} */ items) {
  /** @type {any} */ (window).EXCALIDRAW_ASSET_PATH = `${ESM}@excalidraw/excalidraw@${V}/dist/prod/`;
  document.head.insertAdjacentHTML("beforeend", `<link rel="stylesheet" href="${ESM}@excalidraw/excalidraw@${V}/dist/prod/index.css">
<style>html, body, #xroot { height: 100%; margin: 0; } #xmsg { padding: 16px; white-space: pre-wrap; font: 13px ui-monospace, monospace; color: #c92a2a; }</style>`);
  document.body.insertAdjacentHTML("beforeend", `<div id="xroot"><div id="xmsg">loading…</div></div>`);
  const root = /** @type {HTMLElement} */ (document.getElementById("xroot"));
  try {
    const [React, { createRoot }, X] = await Promise.all([import(`${ESM}react@19.0.0`), import(`${ESM}react-dom@19.0.0/client`),
      import(`${ESM}@excalidraw/excalidraw@${V}?deps=react@19.0.0,react-dom@19.0.0`)]);
    const elements = X.convertToExcalidrawElements(build(items), { regenerateIds: false });
    createRoot(root).render(React.createElement(X.Excalidraw, {
      initialData: { elements, files: {}, appState: { viewBackgroundColor: "#ffffff" } },
      excalidrawAPI: (/** @type {any} */ a) => {
        api = a;
        // text was measured before Excalidraw's font loaded: measure it again once it has, or labels get clipped
        document.fonts.ready.then(() => setTimeout(() => a.updateScene({ elements: X.restoreElements(a.getSceneElements(), null, { refreshDimensions: true, repairBindings: true }) }), 300));
        setTimeout(() => a.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.95, animate: false }), 50);
      },
    }));
  } catch (e) {
    root.textContent = String(/** @type {any} */ (e)?.stack ?? e);
    root.id = "xmsg";
    throw e;
  }
}

// ---- copy for LLM
const r = (/** @type {number} */ n) => Math.round(n);
const q = (/** @type {string} */ s) => JSON.stringify(s.replace(/\n/g, "⏎")).slice(1, -1);
function lines(/** @type {any[]} */ all, /** @type {Set<string>} */ sel) {
  const byId = new Map(all.map((e) => [e.id, e]));
  const nm = (/** @type {any} */ e) => e.customData?.x ? e.id : "*" + e.id.slice(0, 5);  // * = drawn by hand
  const label = (/** @type {any} */ e) => {
    const t = (e.boundElements ?? []).map((b) => byId.get(b.id)).find((b) => b?.type === "text");
    return t ? ` "${q(t.originalText ?? t.text)}"` : "";
  };
  const out = [];
  for (const e of all) {
    if (e.isDeleted || (sel.size && !sel.has(e.id))) continue;
    if (e.type === "text" && e.containerId && byId.has(e.containerId)) continue;  // folded into its container
    const st = [e.backgroundColor !== "transparent" && e.backgroundColor, e.strokeStyle !== "solid" && e.strokeStyle].filter(Boolean).join(" ");
    if (e.type === "arrow" || e.type === "line") {
      const pts = e.points.map((/** @type {number[]} */ p) => `${r(e.x + p[0])},${r(e.y + p[1])}`);
      const a = e.startBinding ? nm(byId.get(e.startBinding.elementId) ?? { id: e.startBinding.elementId }) : pts[0];
      const b = e.endBinding ? nm(byId.get(e.endBinding.elementId) ?? { id: e.endBinding.elementId }) : pts[pts.length - 1];
      const via = pts.length > 2 ? ` via ${pts.slice(1, -1).join(" ")}` : "";
      out.push(`${nm(e)} ${e.type} ${a} -> ${b}${via}${st ? " " + st : ""}${label(e)}`);
    } else if (e.type === "text") {
      out.push(`${nm(e)} text ${r(e.x)},${r(e.y)} "${q(e.originalText ?? e.text)}"`);
    } else if (e.type === "freedraw") {
      out.push(`${nm(e)} freedraw ${r(e.x)},${r(e.y)} ${r(e.width)}x${r(e.height)}`);
    } else {
      out.push(`${nm(e)} ${e.type} ${r(e.x)},${r(e.y)} ${r(e.width)}x${r(e.height)}${st ? " " + st : ""}${label(e)}`);
    }
  }
  return out;
}
/** what Ctrl/Cmd+C puts on the clipboard: the selection (or everything) as one line per element */
function condensed() {
  const all = api.getSceneElements(), sel = new Set(Object.keys(api.getAppState().selectedElementIds ?? {}));
  const body = lines(all, sel);
  return `# ${document.title}: ${sel.size ? body.length + " selected" : "everything"}  (id type x,y wxh [fill] "label"; * = drawn by hand)\n` + body.join("\n") + "\n";
}
// Ctrl/Cmd+C: the condensed lines instead of Excalidraw's own copy (its JSON). Ctrl/Cmd+Shift+C: Excalidraw's own copy.
// Typing in a text box still copies text as usual.
let raw = false;
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "c") { e.preventDefault(); raw = true; document.execCommand("copy"); raw = false; }
}, true);
window.addEventListener("copy", (e) => {
  if (!api || raw || /** @type {any} */ (e.target)?.closest?.("textarea, input")) return;
  e.preventDefault(); e.stopImmediatePropagation();
  e.clipboardData?.setData("text/plain", condensed());
}, true);
