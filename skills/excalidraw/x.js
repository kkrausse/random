// x.js: the whole drawing language. A scene file imports these and default-exports a list of nodes and arrows.
// Nodes know their size (monospace text estimate) and get placed by row / col; arrows bind to node ids and are
// drawn after everything is placed. Output: Excalidraw element skeletons (the page converts them).
//
//   import { box, text, row, col, arrow } from "x";
//   export default [
//     col(40, box("q0", "query strip\n176 × 512"), row(30, box("a", "A", { bg: "blue" }), box("b", "B"))),
//     arrow("q0", "a", "361 × 1024"),
//   ];

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
export function build(/** @type {any[]} */ items) {
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
