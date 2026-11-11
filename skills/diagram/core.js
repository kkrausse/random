// diagram core: the vocabulary (globals D I P O G E L diagram), placement (rows), libavoid routing, lint, SVG. A classic script so the
// viewer can load it on file://; the CLI (dg.ts) imports it the same way. Everything a diagram file needs is a global.
(function boot(root) {  // named: the viewer's route worker is started from this function's own source (DG.src)
  "use strict";
  // ---- colours: fills (light) and inks (strong), by name; any CSS colour also works
  const FILL = { gray: "#e9ecef", grey: "#adb5bd", blue: "#a5d8ff", teal: "#96f2d7", yellow: "#ffec99", green: "#b2f2bb", violet: "#d0bfff",
    cyan: "#99e9f2", orange: "#ffd8a8", pink: "#fcc2d7", lime: "#d8f5a2", indigo: "#bac8ff", red: "#ffc9c9", white: "#ffffff", none: "#ffffff" };
  const INK = { gray: "#868e96", blue: "#1971c2", orange: "#e8590c", red: "#e03131", teal: "#0c8599", green: "#2f9e44", violet: "#7048e8",
    black: "#1e1e1e", cyan: "#0c8599", pink: "#c2255c", indigo: "#3b5bdb", yellow: "#f08c00", lime: "#66a80f" };
  const fill = (c) => FILL[c] ?? c, ink = (c) => INK[c] ?? c;
  const FONT = "DejaVu Sans Mono, Menlo, Consolas, monospace", CW = 0.602, LH = 1.25, FS = 13;

  // ---- vocabulary
  const D = (id, s, o = {}) => ({ id, kind: "data", s, ...o });
  const I = (id, s, ink_, o = {}) => ({ id, kind: "data", input: true, s, ink: ink_, ...o });
  const P = (id, s, w, o = {}) => ({ id, kind: "data", param: w, s, ...o });
  const O = (id, s, w = "none", o = {}) => ({ id, kind: "op", s, w, ...o });
  const G = (id, title, kids, o = {}) => ({ id, kind: "group", title, kids, ...o });
  const E = (from, to, s = "", o = {}) => ({ from, to, s, ...o });
  const L = (a, b, s = "") => ({ a, b, s });
  const all = [], meta = { title: "" };
  const diagram = (title, spec) => { all.push({ title, ...spec }); };
  const title = (s) => { meta.title = String(s); };  // the page's name (browser tab): what this page shows, specifically

  // ---- text measure (monospace: every glyph the same width)
  const lines = (s) => String(s ?? "").split("\n");
  const tw = (s, fs = FS) => Math.max(0, ...lines(s).map((l) => [...l].length)) * fs * CW;
  const th = (s, fs = FS) => lines(s).length * fs * LH;

  // ---- token strip: [count, colour, caption, shown?] or "…"
  const SQ = 10, SG = 2;
  function strip(tok) {
    const segs = []; let x = 0;
    for (const g of tok) {
      if (g === "…") { segs.push({ x, dots: true, w: 14 }); x += 14 + 8; continue; }
      const [n, c, cap = "", show = 6] = g, k = Math.min(n, n > 1 ? show : 1), more = n > k;
      const sw = k * SQ + (k - 1) * SG + (more ? 12 : 0), w = Math.max(sw, tw(cap, 11));
      segs.push({ x, n: k, more, c, cap, w }); x += w + 8;
    }
    return { segs, w: Math.max(0, x - 8), h: SQ + 4 + 11 * LH };
  }

  // ---- node sizes
  const label = (n) => n.def ? `${n.s}\n⧉ defined in: ${n.def}` : n.port ? `${n.s}  ⟨${n.port}⟩` : n.s;
  function size(n) {
    const pad = 10; n = { ...n, s: label(n) };
    if (n.img) { const [, w, h] = n.img; return { w: Math.max(w, tw(n.s)) + 24, h: h + th(n.s) + 30 }; }
    const w = tw(n.s) + 2 * pad, h = th(n.s) + 2 * 7;
    if (n.tok) { const S = strip(n.tok); return { w: Math.max(w, S.w + 2 * pad), h: h + S.h + 6 }; }
    return { w, h };
  }

  // ---- an edge may end on part of a data box's token strip: "id@aux" (the segment whose caption starts with "aux"),
  // or "id@cls..patches" (from the "cls" segment through the "patches" one). Returns [id, from seg index, to seg index] or null.
  const baseId = (t) => String(t).split("@")[0];
  function segOf(n, t) {
    const key = String(t).split("@")[1]; if (key === undefined) return null;
    const segs = strip(n?.tok ?? []).segs, find = (k) => segs.findIndex((g) => !g.dots && String(g.cap).toLowerCase().startsWith(k.trim().toLowerCase()));
    const [a, b = a] = key.split(".."), i = find(a), j = find(b);
    return i < 0 || j < 0 ? undefined : [i, Math.max(i, j)];
  }
  // ---- edges given as "a>b>c" strings or E(...) objects
  const expand = (es) => (es ?? []).flatMap((e) => {
    if (typeof e !== "string") return [e];
    const ids = e.split(">").map((x) => x.trim()); return ids.slice(1).map((to, i) => ({ from: ids[i], to, s: "" }));
  });

  // ---- lint before layout: ids, inputs, dead ends
  function lintGraph(d) {
    const out = [], nodes = new Map(), groups = new Set();
    const walk = (ns) => ns.forEach((n) => {
      if (!n || !n.id) return out.push(`a node without an id: ${JSON.stringify(n)?.slice(0, 80)}`);
      if (nodes.has(n.id) || groups.has(n.id)) out.push(`duplicate id ${n.id}`);
      if (n.kind === "group") { groups.add(n.id); walk(n.kids ?? []); } else nodes.set(n.id, n);
      for (const l of lines(n.s ?? n.title)) if ([...l].length > 90) out.push(`${n.id}: a line of ${[...l].length} chars (wrap it)`);
    });
    walk(d.nodes ?? []);
    const es = expand(d.edges), inc = new Map(), outc = new Map();
    for (const e of es) {
      for (const end of [e.from, baseId(e.to)]) if (!nodes.has(end) && !groups.has(end)) out.push(`edge ${e.from} > ${e.to}: unknown id ${end}`);
      if (String(e.to).includes("@") && nodes.has(baseId(e.to)) && !segOf(nodes.get(baseId(e.to)), e.to)) out.push(`edge ${e.from} > ${e.to}: ${baseId(e.to)} has no token segment "${String(e.to).split("@")[1]}" (captions: ${strip(nodes.get(baseId(e.to)).tok ?? []).segs.filter((g) => !g.dots).map((g) => g.cap).join(", ")})`);
      if (e.hidden) continue;
      inc.set(baseId(e.to), (inc.get(baseId(e.to)) ?? 0) + 1); outc.set(e.from, (outc.get(e.from) ?? 0) + 1);
    }
    for (const l of d.links ?? []) for (const end of [l.a, l.b]) if (!nodes.has(end) && !groups.has(end)) out.push(`link ${l.a} ~ ${l.b}: unknown id ${end}`);
    for (const [id, n] of nodes) {
      if (n.ref) continue;  // drawn for comparison only: not part of this graph's flow
      if (n.kind === "op" && !inc.get(id) && !n.src) out.push(`${id}: op with no input edge (implicit input?)`);
      if (n.kind === "data" && !n.input && !n.param && !inc.get(id) && !n.src) out.push(`${id}: data that comes from nowhere (no edge in)`);
      if (!outc.get(id) && !n.out) out.push(`${id}: dead end (no edge out; mark { out: true } if it is an output)`);
    }
    return out;
  }

  // ---- abstractions: O(id, s, w, { def: "<title of the diagram that defines it>" }). That diagram names its inputs
  // (I(..., { port: "x" })) and outputs (D(..., { out: true, port: "y" })); every edge into the box carries an input's
  // name, each input exactly once, and every edge out carries an output's name.
  function lintDefs(diags) {
    const out = [], flat = (ns) => ns.flatMap((n) => n?.kind === "group" ? flat(n.kids ?? []) : [n]);
    const byTitle = new Map(diags.map((d) => [d.title, d]));
    for (const d of diags) for (const n of flat(d.nodes ?? [])) {
      if (!n?.def) continue;
      const D_ = byTitle.get(n.def); if (!D_) { out.push(`${d.title}: ${n.id}: def "${n.def}" is not a diagram on this page`); continue; }
      const dn = flat(D_.nodes ?? []).filter((x) => !x.ref), ins = dn.filter((x) => x.input), outs = dn.filter((x) => x.out);
      for (const x of [...ins, ...outs]) if (!x.port) out.push(`${n.def}: ${x.id} needs a port name ({ port: "…" }) because ${n.id} uses this definition`);
      const inP = ins.map((x) => x.port), outP = outs.map((x) => x.port), es = expand(d.edges).filter((e) => !e.hidden);
      const got = es.filter((e) => e.to === n.id).map((e) => e.s);
      for (const s of got) if (!inP.includes(s)) out.push(`${d.title}: edge into ${n.id} labelled "${s}": ${n.def} has no input of that name (has: ${inP.join(", ")})`);
      for (const p of inP) { const c = got.filter((s) => s === p).length; if (c !== 1) out.push(`${d.title}: ${n.id} gets input "${p}" ${c} times (must be exactly once)`); }
      for (const e of es.filter((e) => e.from === n.id)) if (!outP.includes(e.s)) out.push(`${d.title}: edge out of ${n.id} labelled "${e.s}": ${n.def} has no output of that name (has: ${outP.join(", ")})`);
    }
    return out;
  }

  // ---- placement: the file decides it. A group (or the diagram) lists its direct contents in `rows`: rows top to
  // bottom, each row's ids left to right; an array inside a row is a column, an array inside that a row, and so on.
  // Columns are centred, rows top-aligned. Without `rows`, contents go in rows by flow (each box one row below
  // whatever feeds it), in file order. Lines are then routed around the boxes by libavoid.
  const GAP = { x: 50, y: 90 };
  // top: the title, then a lane under it for lines entering the group (the title is an obstacle; lines need room to
  // pass between it and the first row, or they get squeezed onto one track)
  const groupPad = (g) => ({ top: (g.deck ? 80 : g.big ? 70 : 56) + (lines(g.title).length - 1) * (g.big ? 22 : 15) * LH + 36, left: 30, right: g.deck ? 70 : 30, bottom: 30 });
  const titleBox = (g, b) => { const tfs = g.big ? 22 : 15; return { x: b.x + 8, y: b.y + 6, w: tw(g.title, tfs) + 12, h: th(g.title, tfs) + 10 }; };
  function placeAll(d, lint) {
    const leaf = new Map(), grp = new Map(), parent = new Map();
    const reg = (ns, p) => ns.forEach((n) => { if (!n?.id) return; parent.set(n.id, p);
      if (n.kind === "group") { grp.set(n.id, n); reg(n.kids ?? [], n.id); } else leaf.set(n.id, { n, ...size(n) }); });
    reg(d.nodes ?? [], null);
    const known = (id) => leaf.has(id) || grp.has(id);
    const es = expand(d.edges).filter((e) => !e.hidden && known(e.from) && known(baseId(e.to)));
    // a box whose tokens receive lines draws its token squares at the top, its text below: the lines stop on the squares
    for (const e of es) { const t = baseId(e.to); if (String(e.to).includes("@") && leaf.has(t)) leaf.get(t).n = { ...leaf.get(t).n, tokTop: true }; }
    const childOf = (id, c) => { let x = id; while (x !== undefined && x !== null && parent.get(x) !== c) x = parent.get(x); return x ?? undefined; };
    // rows by flow: rank = longest chain of edges from the contents' sources; order in a row by where the feeders sit
    function autoRows(ids, cid) {
      const ed = []; for (const e of es) { const a = childOf(e.from, cid), b = childOf(baseId(e.to), cid); if (a && b && a !== b && ids.includes(a) && ids.includes(b)) ed.push([a, b]); }
      const rank = new Map(ids.map((i) => [i, 0]));
      for (let k = 0; k < ids.length; k++) for (const [a, b] of ed) if (rank.get(b) < rank.get(a) + 1 && rank.get(a) + 1 < ids.length) rank.set(b, rank.get(a) + 1);
      const rows = []; for (const i of ids) (rows[rank.get(i)] ??= []).push(i);
      const at = new Map();
      return rows.filter(Boolean).map((row) => {
        const bary = (i) => { const ps = ed.filter(([, b]) => b === i).map(([a]) => at.get(a)).filter((v) => v !== undefined); return ps.length ? ps.reduce((s, v) => s + v, 0) / ps.length : null; };
        const keyed = row.map((i, j) => [i, bary(i) ?? j / Math.max(1, row.length - 1)]);
        keyed.sort((p, q) => p[1] - q[1]); keyed.forEach(([i], j) => at.set(i, row.length > 1 ? j / (row.length - 1) : 0.5));
        return keyed.map(([i]) => i);
      });
    }
    function arrangement(kids, rows, cid, label) {
      const ids = (kids ?? []).filter((n) => n?.id).map((n) => n.id);
      if (!rows) return autoRows(ids, cid);
      const used = new Set();
      const clean = (l) => l.flatMap((x) => {
        if (Array.isArray(x)) { const c = clean(x); return c.length ? [c] : []; }
        if (!ids.includes(x)) { lint.push(`${label}: rows names ${x}, which is not directly inside it${known(x) ? ` (it is inside ${parent.get(x) ?? "the top level"})` : ""}`); return []; }
        if (used.has(x)) { lint.push(`${label}: rows names ${x} twice`); return []; }
        used.add(x); return [x];
      });
      const r = clean(rows), miss = ids.filter((i) => !used.has(i));
      if (miss.length) { lint.push(`${label}: not in its rows (put at the bottom): ${miss.join(", ")}`); r.push(miss); }
      return r;
    }
    const pos = new Map();
    const gapOf = (o) => ({ x: o?.gap?.[0] ?? GAP.x, y: o?.gap?.[1] ?? GAP.y });
    function cell(el, dir, gap) {
      if (!Array.isArray(el)) {
        if (leaf.has(el)) { const s = leaf.get(el); return { w: s.w, h: s.h, put: (x, y) => pos.set(el, { x, y, w: s.w, h: s.h }) }; }
        const g = grp.get(el), P = groupPad(g), inner = cell(arrangement(g.kids, g.rows, g.id, g.id), "col", gapOf(g));
        const tt = titleBox(g, { x: 0, y: 0 }), w = Math.max(inner.w + P.left + P.right, tt.w + 40), h = inner.h + P.top + P.bottom;
        return { w, h, put: (x, y) => { pos.set(el, { x, y, w, h }); inner.put(x + P.left + (w - P.left - P.right - inner.w) / 2, y + P.top); } };
      }
      const parts = el.map((x) => cell(x, dir === "row" ? "col" : "row", gap));
      if (!parts.length) return { w: 0, h: 0, put: () => {} };
      if (dir === "row") {
        const w = parts.reduce((s, p) => s + p.w, 0) + gap.x * (parts.length - 1), h = Math.max(...parts.map((p) => p.h));
        return { w, h, put: (x, y) => { let cx = x; for (const p of parts) { p.put(cx, y); cx += p.w + gap.x; } } };
      }
      const w = Math.max(...parts.map((p) => p.w)), h = parts.reduce((s, p) => s + p.h, 0) + gap.y * (parts.length - 1);
      return { w, h, put: (x, y) => { let cy = y; for (const p of parts) { p.put(x + (w - p.w) / 2, cy); cy += p.h + gap.y; } } };
    }
    const top = cell(arrangement(d.nodes, d.rows, null, d.title), "col", gapOf(d));
    top.put(0, 0);
    return { leaf, grp, parent, es, pos, w: top.w, h: top.h };
  }

  // ---- lines: libavoid routes every line orthogonally, one level of grouping at a time. Each group (and the top
  // level) gets its own router whose obstacles are only its direct contents (a group inside it, deck cards
  // included, is one solid block) and its title. A line that starts or ends inside a group crosses that group's
  // border at a port; so lines enter and leave groups only through their borders, and go round groups they have
  // nothing to do with. Which sides a line uses follows where its ends sit (below: bottom to top; beside: side to
  // side). Ends on one side of a box are spread out, ordered by where their other ends are.
  const DIR = { top: 1, bottom: 2, left: 4, right: 8 }, INWARD = { top: 2, bottom: 1, left: 8, right: 4 };
  const DECK = 42;  // a deck's stacked cards reach this far above and right of its outline
  const outerOf = (g, b) => g?.deck ? { x: b.x, y: b.y - DECK, w: b.w + DECK, h: b.h + DECK } : b;
  const horiz = (s) => s === "top" || s === "bottom";
  function sides(S, T) {
    if (T.y >= S.y + S.h - 1) return ["bottom", "top"];
    if (T.y + T.h <= S.y + 1) return ["top", "bottom"];
    return T.x + T.w / 2 >= S.x + S.w / 2 ? ["right", "left"] : ["left", "right"];
  }
  function route(A, L, lint) {
    const { leaf, grp, pos, parent } = L, RP = A.RoutingParameter;
    const ups = (id) => { const c = []; let x = parent.get(id); while (x !== undefined) { c.push(x); if (x === null) break; x = parent.get(x); } return c; };
    const childIn = (id, K) => { let x = id; while (x !== undefined && parent.get(x) !== K) x = parent.get(x); return x; };
    const box = (id) => outerOf(grp.get(id), pos.get(id));  // what a child is, as an obstacle in its container
    const ctr = (r) => [r.x + r.w / 2, r.y + r.h / 2];
    // 1. every line as pieces, one per container it passes through: { K, a: end, b: end }; an end is an item of K
    // ({ id, side }) or K's own border port ({ port: K, side })
    const lns = [];
    const add = (kind, src, aId, bId, into) => {
      if (!pos.get(aId) || !pos.get(bId) || aId === bId) return;
      const Pa = ups(aId), Pb = ups(bId);
      if (Pa.includes(bId) || Pb.includes(aId)) { lint.push(`${aId} > ${bId}: a line between a group and something inside it is not drawn`); return; }
      const C = Pa.find((k) => Pb.includes(k)), ca = childIn(aId, C), cb = childIn(bId, C);
      let [sa, sb] = kind === "link" ? (ctr(box(cb))[0] >= ctr(box(ca))[0] ? ["right", "left"] : ["left", "right"]) : sides(box(ca), box(cb));
      if (into && cb === bId) { sb = "top"; if (sa === "top") sa = "bottom"; }
      const pieces = [];
      const upK = Pa.slice(0, Pa.indexOf(C)), downK = Pb.slice(0, Pb.indexOf(C)).reverse();
      for (const K of upK) pieces.push({ K, a: { id: childIn(aId, K), side: sa }, b: { port: K, side: sa } });
      pieces.push({ K: C, a: { id: ca, side: sa }, b: { id: cb, side: sb } });
      for (const K of downK) { const it = childIn(bId, K); pieces.push({ K, a: { port: K, side: sb }, b: { id: it, side: into && it === bId ? "top" : sb } }); }
      lns.push({ kind, ...src, aId, bId, into, pieces });
    };
    for (const e of L.es) { const t = baseId(e.to), sg = String(e.to).includes("@") && leaf.has(t) ? segOf(leaf.get(t).n, e.to) : null;
      add("edge", { e, sg }, e.from, t, !!sg); }
    for (const l of L.links) add("link", { l }, l.a, l.b, false);
    // 2. where each end sits along its side (absolute x for top / bottom, y for left / right)
    // group ports first: under the deepest end they lead to, clear of the title, at least 16 apart
    const deep = (ln, g) => (ups(ln.aId).includes(g) ? ln.aId : ln.bId);
    const portEnds = new Map();  // "g|side" -> [{ ends: [...], want }]
    for (const ln of lns) for (const pc of ln.pieces) for (const end of [pc.a, pc.b]) {
      const g = end.port ?? (grp.has(end.id) ? end.id : null); if (g === null || g === undefined) continue;
      const k = g + "|" + end.side; if (!portEnds.has(k)) portEnds.set(k, new Map());
      const m = portEnds.get(k); if (!m.has(ln)) { const c = ctr(pos.get(deep(ln, g))); m.set(ln, { ends: [], want: horiz(end.side) ? c[0] : c[1] }); }
      m.get(ln).ends.push(end);
    }
    for (const [k, m] of portEnds) {
      const [g, side] = k.split("|"), B = pos.get(g), T = titleBox(grp.get(g), B);
      let lo = horiz(side) ? B.x + 14 : B.y + 14; const hi = horiz(side) ? B.x + B.w - 14 : B.y + B.h - 14;
      if (side === "top" && T.x + T.w + 12 < hi - 20) lo = Math.max(lo, T.x + T.w + 12);
      if ((side === "left" || side === "right") && T.y + T.h + 12 < hi - 20) lo = Math.max(lo, T.y + T.h + 12);
      const list = [...m.values()].sort((p, q) => p.want - q.want); let prev = -Infinity;
      for (const it of list) { it.at = Math.max(lo, Math.min(hi, it.want), prev + 16); prev = it.at; }
      const over = prev - hi; if (over > 0) for (const it of list) it.at = Math.max(lo, it.at - over);
      for (const it of list) for (const end of it.ends) end.at = it.at;
    }
    // ends on boxes: a token target at its segment; others spread round the middle of the side, ordered by the other end
    const endPt = (end) => end.at !== undefined && end.at !== null ? end.at : null;
    const bySide = new Map();
    for (const ln of lns) for (const pc of ln.pieces) for (const [me, other] of [[pc.a, pc.b], [pc.b, pc.a]]) {
      if (me.port !== undefined || grp.has(me.id)) continue;
      if (ln.into && me === pc.b && me.id === ln.bId) { const segs = strip(leaf.get(me.id).n.tok).segs, sg = ln.sg;
        me.at = pos.get(me.id).x + 10 + (segs[sg[0]].x + segs[sg[1]].x + Math.min(segs[sg[1]].w, segs[sg[1]].n * (SQ + SG))) / 2; continue; }
      const k = me.id + "|" + me.side; if (!bySide.has(k)) bySide.set(k, []);
      const o = other.port !== undefined || grp.has(other.id) ? null : ctr(box(other.id));
      bySide.get(k).push({ end: me, other, o });
    }
    for (const [k, list] of bySide) {
      const [id, side] = k.split("|"), B = pos.get(id), len = horiz(side) ? B.w : B.h, mid = horiz(side) ? B.x + B.w / 2 : B.y + B.h / 2;
      const key = (it) => it.o ? (horiz(side) ? it.o[0] : it.o[1]) : endPt(it.other) ?? mid;
      list.sort((p, q) => key(p) - key(q));
      const step = Math.min(18, len / (list.length + 1));
      list.forEach((it, i) => { it.end.at = mid + (i - (list.length - 1) / 2) * step; });
    }
    // 3. one router per container; pins on its children and on its own border ports
    const byK = new Map(); for (const ln of lns) for (const pc of ln.pieces) { if (!byK.has(pc.K)) byK.set(pc.K, []); byK.get(pc.K).push(pc); }
    const at = (r, side, v) => side === "top" ? [v, r.y] : side === "bottom" ? [v, r.y + r.h] : side === "left" ? [r.x, v] : [r.x + r.w, v];
    for (const [K, pcs] of byK) {
      const r = new A.Router(A.RouterFlag.OrthogonalRouting.value);
      r.setRoutingParameter(RP.shapeBufferDistance, 8); r.setRoutingParameter(RP.idealNudgingDistance, 10); r.setRoutingParameter(RP.segmentPenalty, 40);
      r.setRoutingOption(A.RoutingOption.nudgeSharedPathsWithCommonEndPoint, true);
      const rect = (b) => new A.Rectangle(new A.Point(b.x, b.y), new A.Point(b.x + b.w, b.y + b.h));
      const shape = new Map();
      for (const [id, p] of parent) if (p === K && pos.get(id)) shape.set(id, { s: new A.ShapeRef(r, rect(box(id))), b: box(id) });
      if (K !== null) new A.ShapeRef(r, rect(titleBox(grp.get(K), pos.get(K))));
      let cls = 1;
      const pin = (end) => {
        if (end.port !== undefined) {  // this container's own border: a tiny shape just inside it, open inward
          const [x, y] = at(pos.get(K), end.side, end.at); end.pt = [x, y];
          const s = new A.ShapeRef(r, rect({ x: x - 1, y: y - 1, w: 2, h: 2 })), c = cls++;
          new A.ShapeConnectionPin(s, c, 0.5, 0.5, true, 0, INWARD[end.side]); return new A.ConnEnd(s, c);
        }
        const { s, b } = shape.get(end.id), [x, y] = at(b, end.side, end.at); end.pt = [x, y];
        const c = cls++; const f = (v) => Math.min(1, Math.max(0, Math.round(v * 1e6) / 1e6));
        new A.ShapeConnectionPin(s, c, f((x - b.x) / b.w), f((y - b.y) / b.h), true, 0, DIR[end.side]); return new A.ConnEnd(s, c);
      };
      const ends = pcs.map((pc) => [pin(pc.a), pin(pc.b)]);  // all pins first, then the connectors
      const conns = ends.map(([a, b]) => new A.ConnRef(r, a, b));
      r.processTransaction();
      pcs.forEach((pc, i) => {
        const p = conns[i].displayRoute(), pts = []; for (let j = 0; j < p.size(); j++) { const q = p.at(j); pts.push([q.x, q.y]); }
        const near = (u, v) => u && Math.abs(u[0] - v[0]) < 1.5 && Math.abs(u[1] - v[1]) < 1.5;
        pc.ok = near(pts[0], pc.a.pt) && near(pts[pts.length - 1], pc.b.pt);
        pc.pts = pc.ok ? pts : [pc.a.pt, pc.b.pt];
      });
      try { r.delete(); } catch {}
    }
    // 4. join each line's pieces (across a deck's cards the join is a straight stretch) and tidy
    for (const ln of lns) {
      const P = [];
      for (const pc of ln.pieces) for (const q of pc.pts) { const l = P[P.length - 1]; if (!l || Math.abs(l[0] - q[0]) > 0.05 || Math.abs(l[1] - q[1]) > 0.05) P.push([Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10]); }
      for (let i = P.length - 2; i > 0; i--) { const [a, b, c] = [P[i - 1], P[i], P[i + 1]]; if ((Math.abs(a[0] - b[0]) < 0.05 && Math.abs(b[0] - c[0]) < 0.05) || (Math.abs(a[1] - b[1]) < 0.05 && Math.abs(b[1] - c[1]) < 0.05)) P.splice(i, 1); }
      ln.pts = P; ln.b = { id: ln.bId };
      if (ln.pieces.some((pc) => !pc.ok)) lint.push(`${ln.kind === "edge" ? ln.e.from + ">" + ln.e.to : ln.l.a + "~" + ln.l.b}: the router could not attach this line (partly drawn straight)`);
    }
    return lns;
  }
  // a label sits on its line: on the last stretch long enough for it (nearest the receiver), away from boxes and other labels
  function placeLabels(items) {
    const boxes = items.filter((i) => i.t === "node"), taken = [];
    const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const it of items) {
      if (it.t !== "edge" || !it.s) continue;
      const w = tw(it.s, 11) + 8, h = 16, P = it.pts, cands = [];
      for (let i = P.length - 1; i > 0; i--) {
        const [x1, y1] = P[i - 1], [x2, y2] = P[i], len = Math.hypot(x2 - x1, y2 - y1), vert = Math.abs(x1 - x2) < 0.5;
        const need = vert ? h + 12 : w + 12; if (len < need) continue;
        for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) {
          const cx = x1 + (x2 - x1) * f, cy = y1 + (y2 - y1) * f;
          const lo = vert ? { x: cx - w / 2, y: cy - h / 2, w, h } : { x: cx - w / 2, y: cy - h / 2, w, h };
          if (Math.abs(f - 0.5) * len + (vert ? h : w) / 2 > len / 2 - 4) continue;
          cands.push(lo);
        }
      }
      const ok = cands.find((c) => !boxes.some((b) => hit(c, b)) && !taken.some((t) => hit(c, t)));
      const lab = ok ?? cands[0] ?? (() => { const [x, y] = P[P.length - 2] ?? P[0]; return { x: x - w / 2, y: y - h / 2, w, h }; })();
      it.lab = lab; taken.push(lab);
    }
  }

  // the lines of one diagram, routed around its boxes where they are now (L.pos); labels kept clear of `boxes`
  function lineItems(A, L, boxes, lint, only) {
    const { leaf, pos } = L, out = [];
    for (const ln of route(A, L, lint)) {
      if (ln.kind === "link") { out.push({ t: "link", id: `${ln.l.a}~${ln.l.b}`, from: ln.l.a, to: ln.l.b, s: ln.l.s, pts: ln.pts }); continue; }
      const e = ln.e, pts = ln.pts.map((p) => [...p]);
      if (ln.into) {  // into a token segment: carry on through the box's top until it touches that segment's squares
        const B = pos.get(ln.b.id), last = pts[pts.length - 1];
        last[1] = B.y + 8 - 2;
      }
      out.push({ t: "edge", id: `${e.from}>${e.to}`, from: e.from, to: baseId(e.to), into: ln.into, pts, ink: e.ink, sw: e.sw, s: e.s });
    }
    placeLabels([...boxes.filter((i) => i.t === "node"), ...out]);
    return out;
  }
  // the viewer, after boxes were dragged: the lines of diagram d named in `only` (all if not given) routed again, the
  // boxes at rectOf(id) (page coords)
  function reroute(A, d, rectOf, only) {
    const L = placeAll(d, []); L.links = d.links ?? [];
    L.pos = new Map([...L.pos.keys()].map((id) => [id, rectOf(id)]).filter(([, r]) => r));
    const boxes = [...L.leaf.keys()].filter((id) => L.pos.has(id)).map((id) => ({ t: "node", id, ...L.pos.get(id) }));
    return lineItems(A, L, boxes, [], only);
  }
  async function layoutOne(d, A) {
    const lint = [], L = placeAll(d, lint); L.links = d.links ?? [];
    const { leaf, grp, pos } = L, items = [];
    const depth = (id) => { let k = 0, x = L.parent.get(id); while (x) { k++; x = L.parent.get(x); } return k; };
    for (const [id, b] of pos) items.push(grp.has(id) ? { t: "group", id, depth: depth(id), ...b, g: grp.get(id) } : { t: "node", id, depth: depth(id), ...b, n: leaf.get(id).n });
    items.push(...lineItems(A, L, items, lint));
    // side: "left" / "right" marks (on boxes, or groups for everything inside): reported when a marked box sits past
    // the average of the other side's boxes
    const sideOf = new Map(); const mark = (ns, sd) => ns.forEach((n) => { if (!n?.id) return; const s2 = n.side ?? sd; if (s2) sideOf.set(n.id, s2); if (n.kind === "group") mark(n.kids ?? [], s2); });
    mark(d.nodes ?? [], undefined);
    const avg = (sd) => { const xs = items.filter((it) => it.t === "node" && sideOf.get(it.id) === sd).map((it) => it.x + it.w / 2); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
    const aL = avg("left"), aR = avg("right");
    if (aL !== null && aR !== null) for (const it of items) { const sd = sideOf.get(it.id); if (!sd || it.t !== "node") continue;
      const cx = it.x + it.w / 2; if ((sd === "left" && cx > aR) || (sd === "right" && cx < aL)) it.wrongSide = sd; }
    // options from the ELK days do nothing now
    const old = []; if (d.mirror) old.push("mirror"); if (d.elk) old.push("elk");
    for (const g of grp.values()) if (g.entries) old.push(`${g.id} entries`);
    for (const e of expand(d.edges)) if (e.short || e.hidden) old.push(`${e.from}>${e.to} ${e.short ? "short" : "hidden"}`);
    if (old.length) lint.push(`options with no effect any more (place with rows instead): ${old.slice(0, 6).join(", ")}${old.length > 6 ? ` … ${old.length - 6} more` : ""}`);
    return { items, lint, w: L.w, h: L.h };
  }

  // ---- lint after layout: flow direction, lines through boxes, overlaps
  function lintLayout(items) {
    const out = [], nodes = items.filter((i) => i.t === "node");
    for (const n of nodes) if (n.wrongSide) out.push(`${n.id}: marked side "${n.wrongSide}" but drawn on the other side`);
    // two lines on the same track (they merge and part, and nobody can tell which is which); lines from one source
    // may share their first stretch, lines into one box their last
    const segs = items.filter((i) => i.t === "edge" || i.t === "link").flatMap((e) => e.pts.slice(1).map((q, i) => ({ e, a: e.pts[i], b: q })));
    const seen = new Set();
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
      const s1 = segs[i], s2 = segs[j]; if (s1.e === s2.e || (s1.e.from && s1.e.from === s2.e.from) || (s1.e.to && s1.e.to === s2.e.to)) continue;
      const v1 = Math.abs(s1.a[0] - s1.b[0]) < 0.5, v2 = Math.abs(s2.a[0] - s2.b[0]) < 0.5; if (v1 !== v2) continue;
      const k = v1 ? 0 : 1, o = 1 - k;  // k: the coordinate that is constant along the segment
      if (Math.abs(s1.a[k] - s2.a[k]) > 1.5) continue;
      const lo = Math.max(Math.min(s1.a[o], s1.b[o]), Math.min(s2.a[o], s2.b[o])), hi = Math.min(Math.max(s1.a[o], s1.b[o]), Math.max(s2.a[o], s2.b[o]));
      const key = s1.e.id + "|" + s2.e.id; if (hi - lo > 4 && !seen.has(key)) { seen.add(key); out.push(`${s1.e.id} and ${s2.e.id} share a track for ${Math.round(hi - lo)} px`); }
    }
    const inside = (b, x, y) => x > b.x + 2 && x < b.x + b.w - 2 && y > b.y + 2 && y < b.y + b.h - 2;
    for (const e of items.filter((i) => i.t === "edge")) {
      const a = e.pts[0], z = e.pts[e.pts.length - 1];
      const S_ = nodes.find((n) => n.id === e.from), T_ = nodes.find((n) => n.id === e.to);  // upward: the receiver sits wholly above the sender
      if (S_ && T_ ? T_.y + T_.h <= S_.y : z[1] < a[1] - 1) out.push(`${e.id}: flows upward`);
      for (const b of nodes) {
        if (b.id === e.from || b.id === e.to) continue;
        for (let i = 1; i < e.pts.length; i++) {
          const [x1, y1] = e.pts[i - 1], [x2, y2] = e.pts[i];
          const hit = x1 === x2 ? x1 > b.x + 2 && x1 < b.x + b.w - 2 && Math.max(y1, y2) > b.y + 2 && Math.min(y1, y2) < b.y + b.h - 2
            : Math.abs(y1 - y2) < 0.5 ? y1 > b.y + 2 && y1 < b.y + b.h - 2 && Math.max(x1, x2) > b.x + 2 && Math.min(x1, x2) < b.x + b.w - 2
            : inside(b, (x1 + x2) / 2, (y1 + y2) / 2);
          if (hit) { out.push(`${e.id}: line runs through ${b.id}`); break; }
        }
      }
    }
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) out.push(`${a.id} overlaps ${b.id}`);
    }
    return out;
  }

  // ---- the page: legend (auto from weights) + every diagram side by side, each with a big title
  async function layoutPage(diags, A, { only } = {}) {
    const items = [], lint = [];
    let X = 0;
    const ds = diags.filter((d) => !only || d.title === only);
    // ids are unique on the whole page (a copied id always names one thing)
    const seen = new Map(), ids = (ns, t) => ns.forEach((n) => { if (!n?.id) return; if (seen.has(n.id) && seen.get(n.id) !== t) lint.push(`id ${n.id} is used in both ${seen.get(n.id)} and ${t}`); seen.set(n.id, t); if (n.kind === "group") ids(n.kids ?? [], t); });
    for (const d of diags) ids(d.nodes ?? [], d.title);
    lint.push(...lintDefs(diags));
    for (const d of ds) {
      const pre = lintGraph(d).map((m) => `${d.title}: ${m}`);
      const r = await layoutOne(d, A);
      const post = [...r.lint, ...lintLayout(r.items)].map((m) => `${d.title}: ${m}`);
      lint.push(...pre, ...post);
      const tfs = d.titleSize ?? 200, sub = d.sub ?? "", y0 = tfs * 1.2 + th(sub, 26) + 80;
      items.push({ t: "text", id: `${d.title}.title`, x: X, y: 0, s: d.title, fs: tfs, bold: true });
      if (sub) items.push({ t: "text", id: `${d.title}.sub`, x: X, y: tfs * 1.2, s: sub, fs: 26, ink: "#495057" });
      for (const it of r.items) items.push(shift(it, X, y0));
      X += Math.max(r.w, tw(sub, 26), tw(d.title, tfs)) + 600;
    }
    const weights = Object.assign({}, ...ds.map((d) => d.weights ?? {}));
    const leg = legend(weights);
    for (const it of leg.items) items.push(shift(it, -leg.w - 400, 0));
    return { items, lint };
  }
  const shift = (it, dx, dy) => ({ ...it, x: it.x + dx, y: it.y + dy, ...(it.pts ? { pts: it.pts.map(([x, y]) => [x + dx, y + dy]) } : {}),
    ...(it.lab ? { lab: { ...it.lab, x: it.lab.x + dx, y: it.lab.y + dy } } : {}) });
  function legend(weights) {
    const rows = [
      [{ kind: "data", s: "data" }, "DOTTED = DATA (tokens drawn inside: one square = one vector, … = more of the same)"],
      [{ kind: "data", input: true, s: "input" }, "THICK DOTTED = A MODEL INPUT"],
      [{ kind: "op", w: "none", s: "op" }, "SOLID = A TRANSFORMATION; its colour = whose weights (same colour = the same weights)"],
      ...Object.entries(weights).map(([k, v]) => [{ kind: "op", w: k, s: k, fillc: v }, ""]),
    ];
    const items = [{ t: "text", id: "legend.h", x: 0, y: 0, s: "HOW TO READ", fs: 32, bold: true }];
    let y = 60, w = 0;
    rows.forEach(([n, s], i) => {
      const z = size(n);
      items.push({ t: "node", id: `legend.${i}`, x: 0, y, w: z.w, h: z.h, n: { ...n, id: `legend.${i}` }, legend: true });
      if (s) items.push({ t: "text", id: `legend.${i}.t`, x: z.w + 16, y: y + 8, s, fs: 14 });
      w = Math.max(w, z.w + 16 + tw(s, 14)); y += z.h + 12;
    });
    items.push({ t: "edge", id: "legend.edge", from: "", to: "", pts: [[0, y + 10], [80, y + 10]], s: "" });
    items.push({ t: "text", id: "legend.e.t", x: 96, y: y + 2, s: "data flow: ball at the source, arrowhead at the receiver", fs: 14 });
    items.push({ t: "link", id: "legend.link", from: "", to: "", pts: [[0, y + 40], [80, y + 40]], s: "" });
    items.push({ t: "text", id: "legend.l.t", x: 96, y: y + 32, s: "dashed violet: the same weights (no data flows)", fs: 14 });
    return { items, w: Math.max(w, 700) };
  }

  // ---- SVG
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const txt = (x, y, s, fs = FS, o = {}) => `<text x="${x}" y="${y}" font-size="${fs}" fill="${o.ink ?? "#1e1e1e"}"${o.bold ? ' font-weight="bold"' : ""}${o.anchor ? ` text-anchor="${o.anchor}"` : ""} xml:space="preserve">` +
    lines(s).map((l, i) => `<tspan x="${x}" dy="${i ? fs * LH : fs * 0.95}">${esc(l)}</tspan>`).join("") + "</text>";
  function nodeSvg(it, weights, img) {
    const n = { ...it.n, s: label(it.n) }, { x, y, w, h } = it;
    const op = n.kind === "op", wfill = n.fillc ?? weights[n.w] ?? weights[n.param] ?? n.w ?? n.param;
    const bg = op ? fill(wfill ?? "white") : n.param ? fill(wfill) : "#ffffff";
    const st = op ? `stroke="${ink(n.ink ?? "black")}" stroke-width="${n.sw ?? 1.2}"`
      : `stroke="${ink(n.ink ?? (n.param ? "black" : "#495057"))}" stroke-width="${n.sw ?? (n.input ? 3 : 1.8)}" stroke-dasharray="${n.input ? "0.1 6" : "0.1 4.5"}" stroke-linecap="round"`;
    let s = `<g data-id="${esc(it.id)}"${n.ref ? ' opacity="0.55"' : ""}><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${op ? 6 : 4}" fill="${bg}" ${st}/>`;
    if (n.def) s += `<rect x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${h - 6}" rx="4" fill="none" stroke="#1e1e1e" stroke-width="1"/>`;  // double border = defined elsewhere
    if (n.img) {
      const [src, iw, ih] = n.img;
      s += `<image href="${esc(img(src))}" x="${x + 12}" y="${y + 10}" width="${iw}" height="${ih}" preserveAspectRatio="none"/>` + txt(x + 12, y + ih + 18, n.s, FS, { ink: ink(n.ink ?? "black") });
    } else s += txt(x + 10, n.tok && n.tokTop ? y + 8 + strip(n.tok).h + 4 : y + 7, n.s, FS, { ink: op ? "#1e1e1e" : ink(n.ink ?? "black") });
    if (n.tok) {
      const S = strip(n.tok), y0 = n.tokTop ? y + 8 : y + h - S.h - 8;
      for (const g of S.segs) {
        const gx = x + 10 + g.x;
        if (g.dots) { s += txt(gx, y0 - 3, "…", 16); continue; }
        for (let i = 0; i < g.n; i++) s += `<rect x="${gx + i * (SQ + SG)}" y="${y0}" width="${SQ}" height="${SQ}" rx="1.5" fill="${fill(g.c)}" stroke="#1e1e1e" stroke-width="0.8"/>`;
        if (g.more) s += txt(gx + g.n * (SQ + SG), y0 - 3, "…", 12);
        if (g.cap) s += txt(gx, y0 + SQ + 2, g.cap, 11, { ink: "#868e96" });
      }
    }
    return s + "</g>";
  }
  // a group is picked by its border or its title only: its inside is empty space (box-select works there)
  function groupSvg(it) {
    const g = it.g, { x, y, w, h } = it, tfs = g.big ? 22 : 15;
    let s = `<g data-id="${esc(it.id)}">`;
    if (g.deck) for (const j of [3, 2, 1]) s += `<rect x="${x + j * 14}" y="${y - j * 14}" width="${w}" height="${h}" rx="8" fill="#fff" stroke="#868e96" stroke-width="1" pointer-events="none"/>` +
      (j === 3 ? txt(x + j * 14 + w - 8, y - j * 14 + 4, "frame 9", 12, { ink: "#868e96", anchor: "end" }).replace("<text ", '<text pointer-events="none" ') : "");
    // fill / ink / sw: a tinted background and a solid border of that width (a lane: "this part is the context")
    const solid = g.deck || g.sw, edge = g.ink ? ink(g.ink) : g.deck ? "#1e1e1e" : "#adb5bd";
    s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${g.fill ? fill(g.fill) : "#fff"}" fill-opacity="${g.deck || g.fill ? 1 : 0.6}" stroke="${edge}" stroke-width="${g.sw ?? (g.deck ? 2 : 1.2)}"${solid ? "" : ' stroke-dasharray="8 6"'} pointer-events="none"/>`;
    s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="none" stroke="transparent" stroke-width="14" pointer-events="stroke"/>`;
    s += `<rect x="${x + 8}" y="${y + 6}" width="${tw(g.title, tfs) + 12}" height="${th(g.title, tfs) + 10}" fill="transparent" pointer-events="all"/>`;
    return s + txt(x + 14, y + 12, g.title, tfs, { ink: g.big ? "#495057" : "#1e1e1e", bold: !!g.big }) + "</g>";
  }
  function edgeSvg(it) {
    const c = ink(it.ink ?? "#495057"), sw = it.sw ?? 1.5, P = it.pts, n = P.length;
    const [ax, ay] = P[n - 2], [bx, by] = P[n - 1], L_ = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / L_, uy = (by - ay) / L_;
    const hl = 9, hw = 4.5, end = [bx - ux * hl, by - uy * hl];
    const d = "M" + [...P.slice(0, -1), end].map((p) => p.join(",")).join("L");
    let s = `<g data-id="${esc(it.id)}"${it.into ? ' pointer-events="none"' : ""}>${it.into ? "" : `<path d="${d}" fill="none" stroke="transparent" stroke-width="10"/>`}<path d="${d}" fill="none" stroke="${c}" stroke-width="${sw}"/>`;
    s += `<circle cx="${P[0][0]}" cy="${P[0][1]}" r="3.5" fill="${c}"/>`;
    s += `<polygon points="${bx},${by} ${end[0] - uy * hw},${end[1] + ux * hw} ${end[0] + uy * hw},${end[1] - ux * hw}" fill="${c}"/>`;
    if (it.s && it.lab) s += `<rect x="${it.lab.x}" y="${it.lab.y}" width="${it.lab.w}" height="${it.lab.h}" fill="#fff" fill-opacity="0.85"/>` + txt(it.lab.x + 4, it.lab.y + 1, it.s, 11, { ink: c });
    return s + "</g>";
  }
  function linkSvg(it) {
    const d = "M" + it.pts.map((p) => p.join(",")).join("L"), m = it.pts[Math.floor(it.pts.length / 2)];
    return `<g data-id="${esc(it.id)}"><path d="${d}" fill="none" stroke="transparent" stroke-width="10"/><path d="${d}" fill="none" stroke="#7048e8" stroke-width="2.5" stroke-dasharray="9 6"/>` +
      (it.s ? `<rect x="${m[0] + 4}" y="${m[1] - 9}" width="${tw(it.s, 12) + 8}" height="18" fill="#fff" fill-opacity="0.9"/>` + txt(m[0] + 8, m[1] - 8, it.s, 12, { ink: "#7048e8", bold: true }) : "") + "</g>";
  }
  function bbox(items) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const it of items) {
      const [w, h] = it.t === "text" ? [tw(it.s, it.fs), th(it.s, it.fs)] : [it.w ?? 0, it.h ?? 0];
      const ps = it.pts ?? [[it.x, it.y], [it.x + w, it.y + h]];
      for (const [x, y] of ps) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  // view: {x, y, w, h} region in diagram units (default: everything + margin); img: src -> href
  function toSvg(page, diags, { view, img = (s) => s, scale = 1 } = {}) {
    const weights = Object.assign({}, ...diags.map((d) => d.weights ?? {}));
    const B = bbox(page.items), v = view ?? { x: B.x - 60, y: B.y - 60, w: B.w + 120, h: B.h + 120 };
    const order = { group: 0, edge: 1, link: 2, node: 3, text: 4 };  // lines under boxes: a press on a box always gets the box
    const rank = (i) => i.into ? order.node + 0.5 : order[i.t];  // a line into a box's tokens is drawn over that box
    const its = [...page.items].sort((a, b) => rank(a) - rank(b) || (a.depth ?? 0) - (b.depth ?? 0));
    const body = its.map((it) => it.t === "node" ? nodeSvg(it, weights, img) : it.t === "group" ? groupSvg(it) : it.t === "edge" ? edgeSvg(it)
      : it.t === "link" ? linkSvg(it) : `<g data-id="${esc(it.id)}">${txt(it.x, it.y, it.s, it.fs, { ink: it.ink, bold: it.bold })}</g>`).join("\n");
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${v.x} ${v.y} ${v.w} ${v.h}" width="${v.w * scale}" height="${v.h * scale}" font-family="${FONT}">` +
      `<rect x="${v.x}" y="${v.y}" width="${v.w}" height="${v.h}" fill="#fff"/>${body}</svg>`;
  }

  // ---- copy lines for a selection: id kind "label" <- inputs -> outputs
  function describe(ids, page, diags) {
    const es = page.items.filter((i) => i.t === "edge"), byId = new Map(page.items.map((i) => [i.id, i]));
    return ids.map((id) => {
      const it = byId.get(id); if (!it) return id;
      if (it.t === "edge" || it.t === "link") return `${id} ${it.t}${it.s ? ` "${it.s}"` : ""}`;
      const label = (it.n?.s ?? it.g?.title ?? it.s ?? "").replace(/\n/g, "⏎");
      const ins = es.filter((e) => e.to === id).map((e) => e.from), outs = es.filter((e) => e.from === id).map((e) => e.to);
      return `${id} ${it.t === "node" ? it.n.kind + (it.n.w && it.n.w !== "none" ? `:${it.n.w}` : "") : it.t} "${label}"` + (ins.length ? ` ← ${ins.join(", ")}` : "") + (outs.length ? ` → ${outs.join(", ")}` : "");
    }).join("\n");
  }

  Object.assign(root, { D, I, P, Pm: P, O, G, E, L, diagram, title });
  root.DG = { src: `(${boot})(self);`, all, meta, layoutPage, reroute, toSvg, describe, bbox, lintGraph, edgeSvg, linkSvg, reset: () => { all.length = 0; meta.title = ""; } };
})(globalThis);
