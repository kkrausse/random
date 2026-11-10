// x.js: draw anything Excalidraw can draw from a script. A classic script (not a module), so it loads from file://
// as well as https. A diagram is its own .js file, shown by the shell page next to this folder:
//
//   index.html?s=path/to/diagram.js        (relative to index.html, or an absolute file:// / https URL)
//
//   // diagram.js: one draw() call; helpers go inside the function, so the file can run again
//   draw(() => {
//     const layer = (i) => row(40, box(`sa${i}`, `self-attention ${i}`, { bg: "blue" }), box(`ff${i}`, `feed-forward ${i}`));
//     return [col(50, box("fz", "FROZEN blocks 1 – 12"), layer(1), layer(2)), arrow("fz", "sa1", "361 × 1024")];
//   }, { title: "my diagram" });
//
// Live: the page re-runs diagram.js every 5 s and when the tab comes back, and updates the canvas in place when the
// result changed (view, zoom and hand-drawn shapes stay). Top right: when it last changed, or the error.
// Ctrl/Cmd+C on the canvas copies the selection (or everything) as one line per element with its id; Ctrl/Cmd+Shift+C
// is Excalidraw's own copy. Shapes drawn by hand on the page are kept (localStorage) across reloads.
(() => {
/** @typedef {{ w: number, h: number, id?: string, place: (x: number, y: number) => any[] }} Node */

// STYLE, on every shape, text, line and arrow:
//   bg: colour (name or #hex)      fill: "solid" | "hachure" | "cross-hatch" | "zigzag"
//   ink: colour                    stroke: "solid" | "dashed" | "dotted"        sw: stroke width (1, 2, 4, ...)
//   rough: 0 | 1 | 2 (sloppiness)  opacity: 0 – 100                            angle: degrees
//   round: true / false (corners; curves on lines and arrows)
//   font: "mono" | "code" | "hand" | "sans" | "virgil" | "helvetica" | "lilita" | "serif"
//   fs: font size                  align: "left" | "center" | "right"           valign: "top" | "middle" | "bottom"
//   link: URL                      locked: true                                 group: id or [ids]
//   w, h: size (shapes size themselves to their text otherwise)
const COLORS = { blue: "#a5d8ff", green: "#b2f2bb", yellow: "#ffec99", red: "#ffc9c9", orange: "#ffd8a8", violet: "#d0bfff",
  gray: "#e9ecef", pink: "#fcc2d7", teal: "#96f2d7", cyan: "#99e9f2", indigo: "#bac8ff", lime: "#d8f5a2", white: "#ffffff", black: "#1e1e1e" };
const INK = { blue: "#1971c2", green: "#2f9e44", red: "#e03131", orange: "#f08c00", violet: "#6741d9", gray: "#868e96", black: "#1e1e1e",
  pink: "#c2255c", teal: "#099268", cyan: "#0c8599", indigo: "#3b5bdb", yellow: "#f08c00", lime: "#66a80f", white: "#ffffff" };
const FONTS = { virgil: 1, helvetica: 2, mono: 3, hand: 5, sans: 6, lilita: 7, code: 8, serif: 9 };
const CHAR = { 1: 0.6, 2: 0.55, 3: 0.6, 5: 0.58, 6: 0.55, 7: 0.5, 8: 0.6, 9: 0.5 };  // average char width (em), for sizing
const FS = 16, PAD = 12, LH = 1.25;
const colour = (/** @type {string | undefined} */ c, /** @type {Record<string, string>} */ map) => c && (map[c] ?? c);
const font = (/** @type {any} */ o) => FONTS[o.font ?? "mono"] ?? o.font;
const measure = (/** @type {string} */ s, /** @type {any} */ o) => {
  const fs = o.fs ?? FS, lines = String(s).split("\n");
  return { w: Math.max(...lines.map((l) => l.length)) * fs * (CHAR[font(o)] ?? 0.6), h: lines.length * fs * LH };
};
// older spellings still accepted: dashed: true, left: true, shape: "ellipse" | "diamond"
const compat = (/** @type {any} */ o) => ({ ...o, ...(o.dashed && !o.stroke && { stroke: "dashed" }), ...(o.left && !o.align && { align: "left" }) });
const look = (/** @type {any} */ o) => (o = compat(o), {
  ...(o.bg && { backgroundColor: colour(o.bg, COLORS), fillStyle: o.fill ?? "solid" }),
  ...(o.ink && { strokeColor: colour(o.ink, INK) }),
  ...(o.stroke && { strokeStyle: o.stroke }),
  ...(o.sw && { strokeWidth: o.sw }),
  roughness: o.rough ?? 0,
  ...(o.opacity != null && { opacity: o.opacity }),
  ...(o.angle && { angle: (o.angle * Math.PI) / 180 }),
  ...(o.link && { link: o.link }),
  ...(o.locked && { locked: true }),
  ...(o.group && { groupIds: [o.group].flat() }),
  customData: { x: 1 },
});
const label = (/** @type {string} */ s, /** @type {any} */ o) => (o = compat(o), { text: s, fontSize: o.fs ?? FS, fontFamily: font(o), textAlign: o.align ?? "center",
  verticalAlign: o.valign ?? "middle", ...(o.ink && { strokeColor: colour(o.ink, INK) }) });

const shape = (/** @type {string} */ type) => (/** @type {string} */ id, s = "", /** @type {any} */ o = {}) => {
  const t = measure(s, o), k = type === "rectangle" ? 1 : type === "ellipse" ? 1.45 : 2;  // ellipses and diamonds need room for text
  const w = o.w ?? Math.max(40, t.w * k + 2 * PAD), h = o.h ?? Math.max(30, t.h * k + 2 * PAD);
  return { id, w, h, place: (/** @type {number} */ x, /** @type {number} */ y) => [{ type, id, x, y, width: w, height: h,
    roundness: (o.round ?? type === "rectangle") ? { type: 3 } : null, ...look(o), ...(s && { label: label(s, o) }) }] };
};
/** A rectangle with a label: box(id, text, STYLE). */
const box = (/** @type {string} */ id, s = "", /** @type {any} */ o = {}) => shape(o.shape ?? "rectangle")(id, s, o);
/** An ellipse with a label. */
const ellipse = shape("ellipse");
/** A diamond with a label. */
const diamond = shape("diamond");

/** Free text: text(id, s, STYLE). */
function text(/** @type {string} */ id, /** @type {string} */ s, /** @type {any} */ o = {}) {
  const t = measure(s, o);
  return { id, w: t.w, h: t.h, place: (/** @type {number} */ x, /** @type {number} */ y) => [{ type: "text", id, x, y, text: s, fontSize: o.fs ?? FS,
    fontFamily: font(o), textAlign: o.align ?? "left", verticalAlign: "top", ...look(o) }] };
}

const box_ = (/** @type {number[][]} */ pts) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};
/** A line through points ([[x, y], ...], relative to its own top-left): line(id, points, STYLE + { closed: true }). round: curved. */
function line(/** @type {string} */ id, /** @type {number[][]} */ pts, /** @type {any} */ o = {}) {
  const b = box_(pts);
  return { id, w: b.w, h: b.h, place: (/** @type {number} */ x, /** @type {number} */ y) => [{ type: "line", id, x: x - b.x0, y: y - b.y0, width: b.w, height: b.h,
    points: o.closed ? [...pts, pts[0]] : pts, roundness: o.round ? { type: 2 } : null, ...look(o), ...(o.closed && { polygon: true }) }] };
}
/** A freehand pen stroke through points (relative): pen(id, points, STYLE). */
function pen(/** @type {string} */ id, /** @type {number[][]} */ pts, /** @type {any} */ o = {}) {
  const b = box_(pts);
  return { id, w: b.w, h: b.h, place: (/** @type {number} */ x, /** @type {number} */ y) => [{ type: "freedraw", id, x: x - b.x0, y: y - b.y0, width: b.w, height: b.h,
    points: pts, pressures: [], simulatePressure: true, ...look(o) }] };
}
/** An image from a URL (or data: URL): image(id, url, { w, h, ...STYLE }). */
function image(/** @type {string} */ id, /** @type {string} */ url, /** @type {any} */ o = {}) {
  const w = o.w ?? 200, h = o.h ?? 150;
  return { id, w, h, place: (/** @type {number} */ x, /** @type {number} */ y) => [{ type: "image", id, x, y, width: w, height: h, fileId: id, src: url, ...look(o) }] };
}
/** A live embedded web page / video (YouTube, Figma, any https URL): embed(id, url, { w, h }). */
function embed(/** @type {string} */ id, /** @type {string} */ url, /** @type {any} */ o = {}) {
  const w = o.w ?? 480, h = o.h ?? 270;
  return { id, w, h, place: (/** @type {number} */ x, /** @type {number} */ y) => [{ type: "embeddable", id, x, y, width: w, height: h, link: url, ...look(o) }] };
}

/** align: "start" | "center" | "end" across the stacking direction */
const stack = (/** @type {boolean} */ across, /** @type {number} */ g, /** @type {Node[]} */ kids, /** @type {string} */ align) => {
  kids = kids.flat().filter(Boolean);
  const main = across ? "w" : "h", cross = across ? "h" : "w";
  const len = kids.reduce((s, k) => s + k[main], 0) + g * Math.max(0, kids.length - 1), wide = Math.max(0, ...kids.map((k) => k[cross]));
  return { w: across ? len : wide, h: across ? wide : len, place: (/** @type {number} */ x, /** @type {number} */ y) => {
    let at = 0;
    return kids.flatMap((k) => {
      const off = align === "start" ? 0 : align === "end" ? wide - k[cross] : (wide - k[cross]) / 2;
      const r = across ? k.place(x + at, y + off) : k.place(x + off, y + at);
      at += k[main] + g;
      return r;
    });
  } };
};
/** Side by side: row(gap, ...nodes) or row({ gap, align: "start" | "center" | "end" }, ...nodes). */
const row = (/** @type {number | { gap?: number, align?: string }} */ g, /** @type {Node[]} */ ...kids) =>
  typeof g === "number" ? stack(true, g, kids, "center") : stack(true, g.gap ?? 20, kids, g.align ?? "center");
/** Stacked: col(gap, ...nodes) or col({ gap, align }, ...nodes). */
const col = (/** @type {number | { gap?: number, align?: string }} */ g, /** @type {Node[]} */ ...kids) =>
  typeof g === "number" ? stack(false, g, kids, "center") : stack(false, g.gap ?? 20, kids, g.align ?? "center");
/** A node at a fixed canvas position (top level). */
const at = (/** @type {number} */ x, /** @type {number} */ y, /** @type {Node} */ n) => ({ ...n, at: [x, y] });
/** A named Excalidraw frame around a node. */
function frame(/** @type {string} */ id, /** @type {string} */ name, /** @type {Node} */ n, pad = 30) {
  return { id, w: n.w + 2 * pad, h: n.h + 2 * pad, place: (/** @type {number} */ x, /** @type {number} */ y) => {
    const kids = n.place(x + pad, y + pad);
    return [...kids, { type: "frame", id, name, x, y, width: n.w + 2 * pad, height: n.h + 2 * pad, children: kids.map((k) => k.id), customData: { x: 1 } }];
  } };
}
/** Group a node's elements (they select and move together). */
function group(/** @type {string} */ id, /** @type {Node} */ n) {
  return { ...n, id, place: (/** @type {number} */ x, /** @type {number} */ y) => n.place(x, y).map((e) => ({ ...e, groupIds: [...(e.groupIds ?? []), id] })) };
}
/** An existing .excalidraw file (URL relative to the page), shown as it is. */
const file = (/** @type {string} */ url) => ({ file: url });

/** An arrow: arrow(from, to, label, STYLE + { start, end, elbow, via, id }). from / to: an element id (bound) or [x, y].
 * start / end: arrowheads "arrow" | "triangle" | "triangle_outline" | "bar" | "circle" | "circle_outline" | "diamond" |
 * "diamond_outline" | "crowfoot_one" | "crowfoot_many" | "crowfoot_one_or_many" | null (default: none → arrow).
 * Straight by default; round: curved through via; elbow: right angles through the facing sides; via: [[x, y], ...]. */
function arrow(/** @type {string | number[]} */ from, /** @type {string | number[]} */ to, s = "", /** @type {any} */ o = {}) {
  return { arrow: true, from, to, label: s, o };
}

function build(/** @type {any[]} */ items) {
  items = items.flat(Infinity).filter(Boolean);
  const out = [];
  let y = 0;
  for (const n of items) if (!n.arrow && !n.file) {
    if (n.at) { out.push(...n.place(n.at[0], n.at[1])); continue; }
    out.push(...n.place(0, y)); y += n.h + 60;
  }
  const byId = new Map(out.map((e) => [e.id, e]));
  const end = (/** @type {any} */ r) => (Array.isArray(r) ? { type: "point", x: r[0], y: r[1], width: 0, height: 0 } : byId.get(r));
  for (const a of items) if (a.arrow) {
    const s = end(a.from), e = end(a.to), o = a.o;
    if (!s || !e) throw new Error(`arrow ${a.from} -> ${a.to}: no element ${!s ? a.from : a.to}`);
    const c = (/** @type {any} */ el) => [el.x + (el.width ?? 0) / 2, el.y + (el.height ?? 0) / 2];
    const edgeTo = (/** @type {any} */ el, /** @type {number[]} */ p) => {  // where the line to p leaves el, 4 px off its edge
      if (el.type === "point") return [el.x, el.y];
      const [x0, y0] = c(el), lx = p[0] - x0, ly = p[1] - y0, len = Math.hypot(lx, ly) || 1;
      const t = Math.min((el.width ?? 0) / 2 / (Math.abs(lx) || 1e-9), (el.height ?? 0) / 2 / (Math.abs(ly) || 1e-9)) + 4 / len;
      return [x0 + lx * t, y0 + ly * t];
    };
    const [cx, cy] = c(s), [dx, dy] = c(e);
    /** @type {number[][]} */ let mid = o.via ?? [];
    if (o.elbow && !mid.length) mid = Math.abs(dx - cx) >= Math.abs(dy - cy) ? [[(cx + dx) / 2, cy], [(cx + dx) / 2, dy]] : [[cx, (cy + dy) / 2], [dx, (cy + dy) / 2]];
    const p0 = edgeTo(s, mid[0] ?? [dx, dy]), p1 = edgeTo(e, mid[mid.length - 1] ?? [cx, cy]);
    const pts = [p0, ...mid, p1], [sx, sy] = p0, b = box_(pts);
    // bound to shapes only: an arrow bound to a free text element pulls that text onto itself as its label
    const bind = (/** @type {any} */ el, /** @type {any} */ r) => el.type !== "text" && el.type !== "point" && { id: r };
    out.push({ type: "arrow", id: o.id ?? `${a.from}>${a.to}`, x: sx, y: sy, width: b.w, height: b.h, points: pts.map((p) => [p[0] - sx, p[1] - sy]),
      roundness: o.round ? { type: 2 } : null, startArrowhead: o.start ?? null, endArrowhead: o.end === undefined ? "arrow" : o.end,
      ...(bind(s, a.from) && { start: bind(s, a.from) }), ...(bind(e, a.to) && { end: bind(e, a.to) }), ...look(o),
      ...(a.label && { label: label(a.label, { fs: 14, ...o }) }) });
  }
  return out;
}

const V = "0.18.0", ESM = "https://esm.sh/";
/** @type {any} */ let api, X, scriptSrc = "", lastKey = "", ran = false;
const clock = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const status = (/** @type {string} */ t, bad = false) => {
  const el = document.getElementById("xstat");
  if (el) { el.textContent = t; el.style.color = bad ? "#c92a2a" : "#868e96"; }
};
const imgData = async (/** @type {string} */ url) => {
  const blob = await (await fetch(url)).blob();
  return { blob, dataURL: await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); }) };
};

/** Show the diagram: draw(items or () => items, { title, dark, grid, bg }). Called again (live update): redraws in place. */
async function draw(/** @type {any} */ items, /** @type {{ title?: string, dark?: boolean, grid?: boolean, bg?: string }} */ opts = {}) {
  const src = /** @type {any} */ (document.currentScript)?.src;  // must be read before any await
  ran = true;
  if (src && !scriptSrc) { scriptSrc = src.replace(/[?&]t=\d+$/, ""); watch(); }
  try {
    if (typeof items === "function") items = await items();  // may be async (e.g. a layout engine); src and ran are set before this
    if (opts.title) document.title = opts.title;
    const base = scriptSrc || location.href;
    const sk = build(items), key = JSON.stringify([sk, opts]);
    if (key === lastKey) return;  // re-run, nothing changed
    if (!X) await mount(opts);
    const files = /** @type {Record<string, any>} */ ({});
    for (const e of sk) if (e.type === "image") {  // images: fetched into the scene's files (file:// pages cannot fetch)
      const url = new URL(e.src, base).href;
      try {
        // file:// pages cannot fetch, but the canvas can still show the image from its URL
        const { blob, dataURL } = url.startsWith("file:") ? { blob: null, dataURL: url } : await imgData(url);
        files[e.fileId] = { id: e.fileId, dataURL, mimeType: blob?.type || (/\.jpe?g$/i.test(url) ? "image/jpeg" : /\.svg$/i.test(url) ? "image/svg+xml" : "image/png"), created: Date.now() };
        delete e.src;
      } catch {
        Object.assign(e, { type: "rectangle", strokeStyle: "dashed", label: { text: `image ${e.src}\n(could not load here)`, fontSize: 13, fontFamily: 3 } });
        delete e.src; delete e.fileId;
      }
    }
    // the converter handles shapes, text, lines, arrows, images and frames; pen strokes and embeds go through restore
    const own = new Set(["freedraw", "embeddable"]), later = sk.filter((e) => own.has(e.type)), lateIds = new Set(later.map((e) => e.id));
    const frameOf = new Map(sk.filter((e) => e.type === "frame").flatMap((f) => f.children.filter((/** @type {string} */ c) => lateIds.has(c)).map((/** @type {string} */ c) => [c, f.id])));
    const conv = sk.filter((e) => !own.has(e.type)).map((e) => e.type === "frame" ? { ...e, children: e.children.filter((/** @type {string} */ c) => !lateIds.has(c)) } : e);
    let elements = [...X.convertToExcalidrawElements(conv, { regenerateIds: false }),
      ...X.restoreElements(later.map((e) => ({ ...e, frameId: frameOf.get(e.id) ?? null })), null)];
    for (const it of items.flat(Infinity)) if (it?.file) {
      const j = await (await fetch(new URL(it.file, base).href)).json();
      elements = [...elements, ...X.restoreElements(j.elements ?? j, null)];
      Object.assign(files, j.files ?? {});
    }
    // keep what was drawn by hand: on the first draw from localStorage, after that from the canvas
    const ids = new Set(elements.map((/** @type {any} */ e) => e.id));
    const prev = lastKey ? api.getSceneElementsIncludingDeleted() : JSON.parse(localStorage.getItem(KEY()) ?? "[]");
    const scripted = new Set(prev.filter((/** @type {any} */ e) => e.customData?.x).map((/** @type {any} */ e) => e.id));
    const mine = prev.filter((/** @type {any} */ e) => !e.isDeleted && !e.customData?.x && !ids.has(e.id) && !(e.containerId && scripted.has(e.containerId)));
    api.addFiles(Object.values(files));
    api.updateScene({ elements: [...elements, ...X.restoreElements(mine, null)], appState: { viewBackgroundColor: colour(opts.bg, COLORS) ?? (opts.dark ? "#121212" : "#ffffff"), theme: opts.dark ? "dark" : "light", gridModeEnabled: !!opts.grid } });
    // text was measured before Excalidraw's font loaded: measure it again once it has, or labels get clipped
    document.fonts.ready.then(() => setTimeout(() => api.updateScene({ elements: X.restoreElements(api.getSceneElements(), null, { refreshDimensions: true, repairBindings: true }) }), 300));
    if (!lastKey) setTimeout(() => api.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.95, animate: false }), 80);
    status(`${lastKey ? "updated" : "loaded"} ${clock()}${scriptSrc ? "   ·   live" : ""}`);
    lastKey = key;
  } catch (e) {
    if (!X) { document.body.textContent = String(/** @type {any} */ (e)?.stack ?? e); throw e; }
    status(`error ${clock()}: ${/** @type {any} */ (e)?.message ?? e}`, true);
  }
}
const KEY = () => "xjs:" + (scriptSrc || location.pathname);

/** Excalidraw on the page, once. */
async function mount(/** @type {any} */ opts) {
  /** @type {any} */ (window).EXCALIDRAW_ASSET_PATH = `${ESM}@excalidraw/excalidraw@${V}/dist/prod/`;
  document.head.insertAdjacentHTML("beforeend", `<link rel="stylesheet" href="${ESM}@excalidraw/excalidraw@${V}/dist/prod/index.css">
<style>html, body, #xroot { height: 100%; margin: 0; }
#xstat { position: fixed; top: 62px; right: 18px; z-index: 5; font: 12px ui-monospace, monospace; color: #868e96; pointer-events: none; }</style>`);
  document.body.insertAdjacentHTML("beforeend", `<div id="xroot"></div><div id="xstat">loading…</div>`);
  const [React, { createRoot }, mod] = await Promise.all([import(`${ESM}react@19.0.0`), import(`${ESM}react-dom@19.0.0/client`),
    import(`${ESM}@excalidraw/excalidraw@${V}?deps=react@19.0.0,react-dom@19.0.0`)]);
  /** @type {any} */ let t;
  const save = (/** @type {any[]} */ els) => { clearTimeout(t); t = setTimeout(() => {  // hand-drawn shapes -> localStorage
    const hand = new Set(els.filter((e) => !e.isDeleted && !e.customData?.x && !e.containerId).map((e) => e.id));
    const keep = els.filter((e) => !e.isDeleted && (hand.has(e.id) || (e.containerId && hand.has(e.containerId))));
    try { localStorage.setItem(KEY(), JSON.stringify(keep)); } catch {}
  }, 400); };
  await new Promise((ready) => createRoot(/** @type {HTMLElement} */ (document.getElementById("xroot"))).render(React.createElement(mod.Excalidraw, {
    initialData: { elements: [], appState: { viewBackgroundColor: "#ffffff" } }, validateEmbeddable: true, onChange: save,
    excalidrawAPI: (/** @type {any} */ a) => { api = a; ready(a); },
  })));
  X = mod;
}

/** Live update: re-run the diagram's .js every 5 s and when the tab comes back (a new script tag, so it works on file://). */
function watch() {
  const rerun = () => {
    const s = document.createElement("script");
    s.src = scriptSrc + (scriptSrc.includes("?") ? "&" : "?") + "t=" + Date.now();
    // a syntax error stops the file before draw(); browsers hide file:// error details, so notice that draw() never ran
    ran = false;
    s.onload = () => { s.remove(); if (!ran) status(`error ${clock()}: ${scriptSrc.split("/").pop()} did not run (syntax error? see the console)`, true); };
    s.onerror = () => { s.remove(); status(`error ${clock()}: cannot load ${scriptSrc}`, true); };
    document.head.append(s);
  };
  setInterval(() => !document.hidden && rerun(), 5000);
  document.addEventListener("visibilitychange", () => !document.hidden && rerun());
  window.addEventListener("error", (e) => { if (e.filename?.startsWith(scriptSrc)) status(`error ${clock()}: ${e.message} (line ${e.lineno})`, true); });
}

// ---- copy for LLM
const r = (/** @type {number} */ n) => Math.round(n);
const q = (/** @type {string} */ s) => JSON.stringify(s.replace(/\n/g, "⏎")).slice(1, -1);
function lines(/** @type {any[]} */ all, /** @type {Set<string>} */ sel) {
  const byId = new Map(all.map((e) => [e.id, e]));
  const nm = (/** @type {any} */ e) => e.customData?.x ? e.id : "*" + e.id.slice(0, 5);  // * = drawn by hand
  const lab = (/** @type {any} */ e) => {
    const t = (e.boundElements ?? []).map((/** @type {any} */ b) => byId.get(b.id)).find((/** @type {any} */ b) => b?.type === "text");
    return t ? ` "${q(t.originalText ?? t.text)}"` : "";
  };
  const out = [];
  for (const e of all) {
    if (e.isDeleted || (sel.size && !sel.has(e.id))) continue;
    if (e.type === "text" && e.containerId && byId.has(e.containerId)) continue;  // folded into its container
    const st = [e.backgroundColor !== "transparent" && e.backgroundColor, e.fillStyle !== "solid" && e.backgroundColor !== "transparent" && e.fillStyle,
      e.strokeStyle !== "solid" && e.strokeStyle, e.roughness && `rough ${e.roughness}`].filter(Boolean).join(" ");
    if (e.type === "arrow" || e.type === "line") {
      const pts = e.points.map((/** @type {number[]} */ p) => `${r(e.x + p[0])},${r(e.y + p[1])}`);
      const a = e.startBinding ? nm(byId.get(e.startBinding.elementId) ?? { id: e.startBinding.elementId }) : pts[0];
      const b = e.endBinding ? nm(byId.get(e.endBinding.elementId) ?? { id: e.endBinding.elementId }) : pts[pts.length - 1];
      const via = pts.length > 2 ? ` via ${pts.slice(1, -1).join(" ")}` : "";
      out.push(`${nm(e)} ${e.type} ${a} -> ${b}${via}${st ? " " + st : ""}${lab(e)}`);
    } else if (e.type === "text") {
      out.push(`${nm(e)} text ${r(e.x)},${r(e.y)} "${q(e.originalText ?? e.text)}"`);
    } else if (e.type === "frame") {
      out.push(`${nm(e)} frame ${r(e.x)},${r(e.y)} ${r(e.width)}x${r(e.height)} "${q(e.name ?? "")}"`);
    } else if (e.type === "embeddable") {
      out.push(`${nm(e)} embed ${r(e.x)},${r(e.y)} ${r(e.width)}x${r(e.height)} ${e.link}`);
    } else {
      out.push(`${nm(e)} ${e.type} ${r(e.x)},${r(e.y)} ${r(e.width)}x${r(e.height)}${st ? " " + st : ""}${lab(e)}`);
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
let rawCopy = false;
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "c") { e.preventDefault(); rawCopy = true; document.execCommand("copy"); rawCopy = false; }
}, true);
window.addEventListener("copy", (e) => {
  if (!api || rawCopy || /** @type {any} */ (e.target)?.closest?.("textarea, input")) return;
  e.preventDefault(); e.stopImmediatePropagation();
  e.clipboardData?.setData("text/plain", condensed());
}, true);

Object.assign(window, { draw, box, ellipse, diamond, text, line, pen, image, embed, row, col, at, frame, group, file, arrow });
})();
