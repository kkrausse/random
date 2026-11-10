// @ts-check
// Diagram builder: describe a figure as nodes in lanes and rows and it is laid out for you. Boxes size to their text,
// a lane is as wide as its widest cell, a row as tall as its tallest; a cell may span lanes. Arrows connect nodes and
// are resolved after layout, so adding a detail never means redoing coordinates.
//
// Plain JavaScript (ES module): runs in the browser as written (the page imports your scene file) and under bun / node.
// The comments carry the types: `bunx tsc --noEmit --allowJs --checkJs --target es2022 --module esnext scene.js` checks a scene.
//
//   import { lanes, box, arrow, render, R, L } from "./diagram.js";
//   const g = lanes(["a", "b", "c"]);
//   const x = box("hello"), y = box("spans b and c", { stretch: true });
//   g.row({ a: x, "b:c": y });
//   arrow(R(x), L(y), { label: "to" });
//   export default render(g.node());
//
// render() returns the excalidraw skill's .excs text (one element per line); EXCS.build (excs.js) makes the scene.

/**
 * @typedef {object} N a laid-out thing: a box, a label, a token strip, a row / column of things, a lanes grid
 * @property {string} id
 * @property {number} w
 * @property {number} h
 * @property {number} x
 * @property {number} y
 * @property {boolean} [stretch] a lanes cell widens this node to the cell
 * @property {(x: number, y: number) => void} place
 * @property {(out: string[]) => void} draw
 */
/** @typedef {() => [number, number]} P a point, read after layout */
/**
 * @typedef {object} BoxOpts
 * @property {string} [bg] fill
 * @property {string} [stroke]
 * @property {string} [tc] text colour
 * @property {number} [fs] font size (12)
 * @property {number} [pad] (8)
 * @property {number} [w] minimum width
 * @property {number} [h] minimum height
 * @property {number} [sw] stroke width
 * @property {boolean} [dashed]
 * @property {boolean} [sharp] square corners
 * @property {boolean} [left] left-aligned text
 * @property {boolean} [stretch] fill the lanes cell (or span)
 * @property {"rect" | "ellipse"} [shape]
 */
/**
 * @typedef {object} ArrowOpts
 * @property {string} [label]
 * @property {string} [color]
 * @property {string} [lcolor] label colour (default: color)
 * @property {number} [sw]
 * @property {boolean} [dashed]
 * @property {boolean} [line] no arrowhead
 * @property {boolean} [under] draw beneath the nodes: where it meets a filled box it passes behind it
 * @property {"hv" | "vh" | ((a: [number, number], b: [number, number]) => [number, number][])} [via]
 *   "hv": across then down; "vh": down then across; or your own corner points from the two ends
 */
/** @typedef {{ gap?: number, align?: "start" | "center" | "end" }} StackOpts */

export const C = {
  gray: "#e9ecef", blue: "#a5d8ff", yellow: "#ffec99", orange: "#ffd8a8", green: "#b2f2bb", pale: "#f1f3f5",
  ink: "#1e1e1e", mid: "#495057", dim: "#868e96", red: "#e03131", dgreen: "#2f9e44", dorange: "#e67700", dblue: "#1971c2", purple: "#7950f2",
};

let seq = 0;
/** @type {(() => string)[]} */
let arrows = [];
/** @type {(() => string)[]} */
let under = [];
const q = (/** @type {string} */ s) => '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
const r1 = (/** @type {number} */ v) => Math.round(v * 10) / 10;
// the code font is monospace: 0.6 em per character, 1.25 em per line
export const textW = (/** @type {string} */ t, /** @type {number} */ fs) => Math.max(...t.split("\n").map((l) => l.length)) * fs * 0.6;
export const textH = (/** @type {string} */ t, /** @type {number} */ fs) => t.split("\n").length * fs * 1.25;

/** @returns {N} */
function mk(/** @type {number} */ w, /** @type {number} */ h, /** @type {(n: N, out: string[]) => void} */ draw, prefix = "n") {
  /** @type {N} */
  const n = { id: `${prefix}${++seq}`, w, h, x: 0, y: 0, place: (x, y) => { n.x = x; n.y = y; }, draw: (out) => draw(n, out) };
  return n;
}
const style = (/** @type {BoxOpts} */ o) => (o.bg ? ` bg=${o.bg}` : "") + (o.stroke ? ` stroke=${o.stroke}` : "") + (o.sw ? ` sw=${o.sw}` : "")
  + (o.dashed ? " dashed" : "") + (o.sharp ? " sharp" : "");

/** A rectangle sized to its text (w / h are minimums).
 * @param {string} text @param {BoxOpts} [o] @returns {N} */
export function box(text, o = {}) {
  const fs = o.fs ?? 12, pad = o.pad ?? 8;
  const n = mk(Math.max(o.w ?? 0, Math.ceil(textW(text, fs)) + 2 * pad), Math.max(o.h ?? 0, Math.ceil(textH(text, fs)) + 2 * pad), (n, out) => {
    out.push(`${o.shape ?? "rect"} ${n.id} ${r1(n.x)},${r1(n.y)} ${r1(n.w)}x${r1(n.h)}` + style(o) + (o.left ? " talign=left" : "") + (o.tc ? ` tc=${o.tc}` : "") + ` fs=${fs} ${q(text)}`);
  }, "b");
  n.stretch = o.stretch;
  return n;
}

/** The "+" where a branch is added onto a stream. */
export const plus = () => box("+", { shape: "ellipse", bg: "#ffffff", fs: 16, pad: 0, w: 24, h: 24 });

/** Free text.
 * @param {string} text @param {{ fs?: number, color?: string }} [o] @returns {N} */
export function label(text, o = {}) {
  const fs = o.fs ?? 12;
  return mk(Math.ceil(textW(text, fs)), Math.ceil(textH(text, fs)), (n, out) => {
    out.push(`text ${n.id} ${r1(n.x)},${r1(n.y)} fs=${fs}` + (o.color ? ` stroke=${o.color}` : "") + ` ${q(text)}`);
  }, "t");
}

/** Empty room. */
export const space = (/** @type {number} */ w, /** @type {number} */ h) => mk(w, h, () => {}, "s");

/** Items as squares: each group is n squares, or one bar (`bar` px wide) standing for many. `on: false` = hollow.
 * @param {{ n?: number, bar?: number, color: string, on?: boolean }[]} groups @param {{ s?: number, gap?: number }} [o] @returns {N} */
export function squares(groups, o = {}) {
  const s = o.s ?? 7, gap = o.gap ?? 3;
  let w = 0;
  groups.forEach((g, i) => { w += (g.bar ?? ((g.n ?? 1) * (s + 1) - 1)) + (i ? gap : 0); });
  return mk(w, s, (n, out) => {
    let x = n.x;
    groups.forEach((g, gi) => {
      const st = g.on === false ? "bg=#ffffff stroke=#ced4da" : `bg=${g.color} stroke=#343a40`;
      if (g.bar) { out.push(`rect ${n.id}_${gi} ${r1(x)},${r1(n.y)} ${g.bar}x${s} ${st} sw=1 sharp`); x += g.bar; }
      else { for (let j = 0; j < (g.n ?? 1); j++) { out.push(`rect ${n.id}_${gi}_${j} ${r1(x)},${r1(n.y)} ${s}x${s} ${st} sw=1 sharp`); x += s + 1; } x -= 1; }
      x += gap;
    });
  }, "k");
}

/** @returns {N} */
function stack(/** @type {N[]} */ kids, /** @type {boolean} */ horiz, /** @type {StackOpts} */ o = {}) {
  const gap = o.gap ?? 4, al = o.align ?? "center";
  const main = (/** @type {N} */ k) => (horiz ? k.w : k.h), cross = (/** @type {N} */ k) => (horiz ? k.h : k.w);
  const M = kids.reduce((a, k) => a + main(k), 0) + gap * (kids.length - 1), X = Math.max(...kids.map(cross));
  const n = mk(horiz ? M : X, horiz ? X : M, (_n, out) => kids.forEach((k) => k.draw(out)), "g");
  n.place = (x, y) => {
    n.x = x; n.y = y;
    let m = horiz ? x : y;
    const span = horiz ? n.h : n.w;
    for (const k of kids) {
      const c = (horiz ? y : x) + (al === "start" ? 0 : al === "end" ? span - cross(k) : (span - cross(k)) / 2);
      if (horiz) k.place(m, c); else k.place(c, m);
      m += main(k) + gap;
    }
  };
  return n;
}
/** Things side by side. @param {N[]} kids @param {StackOpts} [o] */
export const row = (kids, o) => stack(kids, true, o);
/** Things one under another. @param {N[]} kids @param {StackOpts} [o] */
export const col = (kids, o) => stack(kids, false, o);

/** A rectangle drawn behind a node, with padding.
 * @param {N} kid @param {BoxOpts} [o] @returns {N} */
export function panel(kid, o = {}) {
  const pad = o.pad ?? 8;
  const n = mk(Math.max(o.w ?? 0, kid.w + 2 * pad), kid.h + 2 * pad, (n, out) => {
    out.push(`rect ${n.id} ${r1(n.x)},${r1(n.y)} ${r1(n.w)}x${r1(n.h)}` + style(o));
    kid.draw(out);
  }, "p");
  n.stretch = o.stretch;
  n.place = (x, y) => { n.x = x; n.y = y; kid.place(x + (o.left ? pad : (n.w - kid.w) / 2), y + pad); };
  return n;
}

/**
 * @typedef {object} Lanes
 * @property {(cells: Record<string, N | undefined>, o?: { gap?: number, ay?: "t" | "c" | "b", ax?: "l" | "c" | "r" }) => number} row
 *   add a row; keys are a lane ("qt") or a span of lanes ("f1:f9"); returns the row's index
 * @property {(r0: number, r1: number, o?: { c0?: string, c1?: string, label?: string, pad?: number, color?: string, fs?: number }) => void} band
 *   a dashed frame around rows r0..r1 (all lanes, or lanes c0..c1), with a label at its bottom left
 * @property {() => N} node finish: the grid as one node
 * @property {(c: string) => number} left after layout: a lane's left edge
 * @property {(c: string) => number} right
 * @property {(r: number) => number} top after layout: a row's top
 * @property {(r: number) => number} bottom
 */

/** Lanes (columns) and rows.
 * @param {string[]} cols lane names, left to right
 * @param {{ gx?: number, gy?: number, minW?: Record<string, number> }} [o] gaps between lanes / rows, minimum lane widths
 * @returns {Lanes} */
export function lanes(cols, o = {}) {
  const gx = o.gx ?? 30, gy = o.gy ?? 16;
  /** @type {{ cells: { c0: number, c1: number, node: N }[], gap: number, ay: string, ax: string }[]} */
  const rows = [];
  /** @type {{ r0: number, r1: number, c0: number, c1: number, label?: string, pad: number, color: string, fs: number }[]} */
  const bands = [];
  const ci = (/** @type {string} */ c) => { const i = cols.indexOf(c); if (i < 0) throw new Error(`no lane ${c}`); return i; };
  /** @type {number[]} */ let colW = [];
  /** @type {number[]} */ let colX = [];
  /** @type {number[]} */ let rowH = [];
  /** @type {number[]} */ let rowY = [];
  const spanW = (/** @type {number} */ c0, /** @type {number} */ c1) => colW.slice(c0, c1 + 1).reduce((a, b) => a + b, 0) + gx * (c1 - c0);
  return {
    row(cells, ro = {}) {
      /** @type {{ c0: number, c1: number, node: N }[]} */
      const list = [];
      for (const [k, n] of Object.entries(cells)) { if (!n) continue; const [a, b] = k.split(":"); list.push({ c0: ci(a), c1: ci(b ?? a), node: n }); }
      rows.push({ gap: ro.gap ?? gy, ay: ro.ay ?? "c", ax: ro.ax ?? "c", cells: list });
      return rows.length - 1;
    },
    band(r0, r1, bo = {}) {
      bands.push({ r0, r1, c0: bo.c0 ? ci(bo.c0) : 0, c1: bo.c1 ? ci(bo.c1) : cols.length - 1, label: bo.label, pad: bo.pad ?? 10, color: bo.color ?? C.dim, fs: bo.fs ?? 13 });
    },
    left: (c) => colX[ci(c)], right: (c) => colX[ci(c)] + colW[ci(c)], top: (r) => rowY[r], bottom: (r) => rowY[r] + rowH[r],
    node() {
      colW = cols.map((c) => o.minW?.[c] ?? 0);
      for (const r of rows) for (const c of r.cells) if (c.c0 === c.c1) colW[c.c0] = Math.max(colW[c.c0], c.node.w);
      for (const r of rows) for (const c of r.cells) if (c.c1 > c.c0) {  // a span wider than its lanes widens them evenly
        const need = c.node.w - spanW(c.c0, c.c1);
        if (need > 0) for (let i = c.c0; i <= c.c1; i++) colW[i] += need / (c.c1 - c.c0 + 1);
      }
      for (const r of rows) for (const c of r.cells) if (c.node.stretch) c.node.w = spanW(c.c0, c.c1);
      rowH = rows.map((r) => Math.max(0, ...r.cells.map((c) => c.node.h)));
      const W = spanW(0, cols.length - 1), H = rowH.reduce((a, b) => a + b, 0) + rows.reduce((a, r, i) => a + (i ? r.gap : 0), 0);
      const n = mk(W, H, (n, out) => {
        bands.forEach((b, bi) => {
          const x = colX[b.c0] - b.pad, y = rowY[b.r0] - b.pad, w = spanW(b.c0, b.c1) + 2 * b.pad, h = rowY[b.r1] + rowH[b.r1] - rowY[b.r0] + 2 * b.pad;
          out.push(`rect ${n.id}_band${bi} ${r1(x)},${r1(y)} ${r1(w)}x${r1(h)} stroke=${b.color} dashed sw=1`);
          if (b.label) out.push(`text ${n.id}_bandt${bi} ${r1(x + 8)},${r1(y + h - b.fs * 1.25 - 6)} fs=${b.fs} stroke=${b.color} ${q(b.label)}`);
        });
        for (const r of rows) for (const c of r.cells) c.node.draw(out);
      }, "l");
      n.place = (x, y) => {
        n.x = x; n.y = y;
        colX = []; let cx = x;
        for (const w of colW) { colX.push(cx); cx += w + gx; }
        rowY = []; let cy = y;
        rows.forEach((r, i) => { if (i) cy += r.gap; rowY.push(cy); cy += rowH[i]; });
        rows.forEach((r, i) => {
          for (const c of r.cells) {
            const w = spanW(c.c0, c.c1), k = c.node;
            k.place(colX[c.c0] + (r.ax === "l" ? 0 : r.ax === "r" ? w - k.w : (w - k.w) / 2), rowY[i] + (r.ay === "t" ? 0 : r.ay === "b" ? rowH[i] - k.h : (rowH[i] - k.h) / 2));
          }
        });
      };
      return n;
    },
  };
}

// points on a node's sides (f = 0..1 along the side), read after layout
/** @returns {P} */ export const T = (/** @type {N} */ n, f = 0.5) => () => [n.x + n.w * f, n.y];
/** @returns {P} */ export const B = (/** @type {N} */ n, f = 0.5) => () => [n.x + n.w * f, n.y + n.h];
/** @returns {P} */ export const L = (/** @type {N} */ n, f = 0.5) => () => [n.x, n.y + n.h * f];
/** @returns {P} */ export const R = (/** @type {N} */ n, f = 0.5) => () => [n.x + n.w, n.y + n.h * f];

/** An arrow between two points (use T / B / L / R of a node, or any function returning [x, y]).
 * @param {P} a @param {P} b @param {ArrowOpts} [o] */
export function arrow(a, b, o = {}) {
  const id = `a${++seq}`;
  (o.under ? under : arrows).push(() => {
    const p = a(), e = b();
    /** @type {[number, number][]} */
    const mid = o.via === "hv" ? [[e[0], p[1]]] : o.via === "vh" ? [[p[0], e[1]]] : typeof o.via === "function" ? o.via(p, e) : [];
    const pts = [p, ...mid, e].map(([x, y]) => `${r1(x)},${r1(y)}`).join(";");
    const lc = o.lcolor ?? o.color;
    return `${o.line ? "line" : "arrow"} ${id} ${pts}` + (o.color ? ` stroke=${o.color}` : "") + (o.sw ? ` sw=${o.sw}` : "") + (o.dashed ? " dashed" : "")
      + (mid.length ? " elbowed" : "") + (o.label ? " lfs=11" + (lc ? ` ltc=${lc}` : "") + ` ${q(o.label)}` : "");
  });
}

/** Lay the figure out and return its .excs text: `under` arrows, then frames and nodes, then arrows on top.
 * Call once per figure, last: it also clears the arrow list for the next figure in the same page.
 * @param {N} root @returns {string} */
export function render(root) {
  root.place(0, 0);
  const out = ['@scene {"type":"excalidraw","version":2,"source":"https://excalidraw.com","appState":{"viewBackgroundColor":"#ffffff","gridSize":null},"files":{}}'];
  for (const a of under) out.push(a());
  root.draw(out);
  for (const a of arrows) out.push(a());
  arrows = []; under = [];
  return out.join("\n");
}

/** Several built figures on one canvas. rows[i] = the figures of row i, each an array of Excalidraw elements
 * (EXCS.build(text).elements); they are placed left to right, rows stacked, ids made unique per figure.
 * @param {any[][][]} rows @param {{ gapX?: number, gapY?: number }} [o] @returns {any[]} */
export function canvas(rows, o = {}) {
  const gapX = o.gapX ?? 260, gapY = o.gapY ?? 320;
  /** @type {any[]} */ const all = [];
  let y = 0, n = 0;
  for (const figs of rows) {
    let x = 0, hRow = 0;
    for (const els of figs) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const e of els) {
        const pts = e.points ? e.points.map((/** @type {number[]} */ p) => [e.x + p[0], e.y + p[1]]) : [[e.x, e.y], [e.x + (e.width ?? 0), e.y + (e.height ?? 0)]];
        for (const [px, py] of pts) { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
      }
      const pre = `s${n++}_`;
      for (const e of els) {
        e.x += x - x0; e.y += y - y0; e.id = pre + e.id;
        if (e.containerId) e.containerId = pre + e.containerId;
        for (const b of e.boundElements ?? []) b.id = pre + b.id;
        for (const k of ["startBinding", "endBinding"]) if (e[k]?.elementId) e[k].elementId = pre + e[k].elementId;
        e.groupIds = (e.groupIds ?? []).map((/** @type {string} */ g) => pre + g);
        all.push(e);
      }
      x += x1 - x0 + gapX; hRow = Math.max(hRow, y1 - y0);
    }
    y += hRow + gapY;
  }
  return all;
}
