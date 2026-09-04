#!/usr/bin/env node
// exc.mjs — CLI for .excalidraw <-> .excs (see excs.js for the format), plus
// headless validation and a wireframe preview.
//
//   node exc.mjs dump    scene.excalidraw [-o scene.excs]
//   node exc.mjs build   scene.excs [-o scene.excalidraw]
//   node exc.mjs check   scene.excalidraw        invariants, overlaps, arrow crossings
//   node exc.mjs preview scene.excalidraw        approximate render -> .preview.svg(.png)
//
// build here uses estimated text sizes; the bridge page re-measures with the
// real Excalidraw engine when it loads the file, so estimates self-heal. When
// the bridge tab is open you normally never need build — just edit the .excs.

import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
// excs.js is a classic script shared with the bridge page. If scripts/package.json
// ever says "type":"module", require() returns an empty ESM namespace and the
// IIFE only sets globalThis.EXCS, so fall back to that.
const EXCS = (() => { const m = createRequire(import.meta.url)('./excs.js'); return m && m.dump ? m : globalThis.EXCS; })();
if (!EXCS || !EXCS.dump) { console.error('exc.mjs: could not load excs.js'); process.exit(1); }

function check(file) {
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  const els = s.elements.filter((e) => !e.isDeleted);
  const byId = new Map(els.map((e) => [e.id, e]));
  let bad = 0;
  const err = (...a) => { console.log(' ', ...a); bad++; };
  for (const e of els) {
    if (e.containerId) {
      const c = byId.get(e.containerId);
      if (!c) err('missing container:', e.id, '->', e.containerId);
      else if (!(c.boundElements || []).some((b) => b.id === e.id)) err('container missing backref:', e.containerId, '->', e.id);
    }
    for (const b of e.boundElements || []) if (!byId.has(b.id)) err('dangling boundElement:', e.id, '->', b.id);
    for (const k of ['startBinding', 'endBinding']) if (e[k] && !byId.has(e[k].elementId)) err(`dangling ${k}:`, e.id, '->', e[k].elementId);
  }
  // overlaps among solid boxes (transparent/huge boxes are containers or lanes)
  const boxes = els.filter((e) => ['rectangle', 'ellipse', 'diamond'].includes(e.type)
    && e.backgroundColor !== 'transparent' && e.width * e.height < 200000);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
      && !(a.groupIds || []).some((g) => (b.groupIds || []).includes(g))) err('box overlap:', a.id, 'x', b.id);
  }
  const segs = (e) => { const p = e.points.map((q) => [e.x + q[0], e.y + q[1]]); const r = []; for (let i = 1; i < p.length; i++) r.push([p[i - 1], p[i]]); return r; };
  const cross = (a, b, c, d) => {
    const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
    if (!den) return false;
    const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den;
    const u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
    return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
  };
  const arrows = els.filter((e) => e.type === 'arrow' || e.type === 'line');
  let crossings = 0;
  for (let i = 0; i < arrows.length; i++) for (let j = i + 1; j < arrows.length; j++)
    for (const s1 of segs(arrows[i])) for (const s2 of segs(arrows[j]))
      if (cross(s1[0], s1[1], s2[0], s2[1])) { crossings++; console.log('  crossing:', arrows[i].id, 'x', arrows[j].id); }
  console.log(bad ? `${bad} problems` : 'consistent', '| arrow crossings:', crossings);
  return bad;
}

function preview(file) {
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  const els = s.elements.filter((e) => !e.isDeleted);
  const xs = els.flatMap((e) => [e.x, e.x + (e.width || 0)]), ys = els.flatMap((e) => [e.y, e.y + (e.height || 0)]);
  const minX = Math.min(...xs) - 20, minY = Math.min(...ys) - 20;
  const W = Math.max(...xs) - minX + 40, H = Math.max(...ys) - minY + 40;
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${W} ${H}" width="${W / 1.4}" height="${H / 1.4}"><rect x="${minX}" y="${minY}" width="${W}" height="${H}" fill="white"/>`;
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  for (const e of els) {
    const dash = e.strokeStyle === 'dashed' ? ' stroke-dasharray="6 4"' : '';
    if (['rectangle', 'ellipse', 'diamond'].includes(e.type)) {
      const fill = e.backgroundColor === 'transparent' ? 'none' : e.backgroundColor;
      if (e.type === 'ellipse') out += `<ellipse cx="${e.x + e.width / 2}" cy="${e.y + e.height / 2}" rx="${e.width / 2}" ry="${e.height / 2}" fill="${fill}" stroke="${e.strokeColor}" stroke-width="1.5"${dash}/>`;
      else out += `<rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" rx="6" fill="${fill}" stroke="${e.strokeColor}" stroke-width="1.5"${dash}/>`;
    } else if (e.type === 'arrow' || e.type === 'line') {
      const pts = e.points.map((p) => `${e.x + p[0]},${e.y + p[1]}`).join(' ');
      out += `<polyline points="${pts}" fill="none" stroke="${e.strokeColor}" stroke-width="1.5"${dash}/>`;
      if (e.endArrowhead) {
        const last = e.points[e.points.length - 1], prev = e.points[e.points.length - 2] ?? [0, 0];
        const ang = Math.atan2(last[1] - prev[1], last[0] - prev[0]);
        const tip = [e.x + last[0], e.y + last[1]];
        for (const d of [-0.4, 0.4]) out += `<line x1="${tip[0]}" y1="${tip[1]}" x2="${tip[0] - 12 * Math.cos(ang + d)}" y2="${tip[1] - 12 * Math.sin(ang + d)}" stroke="${e.strokeColor}" stroke-width="1.5"/>`;
      }
    } else if (e.type === 'text') {
      e.text.split('\n').forEach((l, i) => {
        const anchor = e.textAlign === 'center' ? 'middle' : 'start';
        const tx = e.textAlign === 'center' ? e.x + e.width / 2 : e.x;
        out += `<text x="${tx}" y="${e.y + (i + 0.9) * e.fontSize * 1.25}" font-size="${e.fontSize}" font-family="Menlo,monospace" text-anchor="${anchor}" fill="${e.strokeColor}">${esc(l)}</text>`;
      });
    }
  }
  out += '</svg>';
  const svg = file.replace(/\.(excalidraw|excs)$/, '') + '.preview.svg';
  fs.writeFileSync(svg, out);
  try {
    execSync(`qlmanage -t -s 2400 -o "${svg.replace(/\/[^/]+$/, '') || '.'}" "${svg}" 2>/dev/null`);
    console.log(`${svg}.png`);
  } catch { console.log(svg, '(qlmanage unavailable; SVG only)'); }
}

const [cmd, file, ...rest] = process.argv.slice(2);
if (!cmd || !file) { console.error('usage: exc.mjs dump|build|check|preview <file> [-o out]'); process.exit(1); }
const oIdx = rest.indexOf('-o');
const outFile = oIdx >= 0 ? rest[oIdx + 1] : null;

if (cmd === 'dump') {
  const text = EXCS.dump(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (outFile) fs.writeFileSync(outFile, text); else process.stdout.write(text);
} else if (cmd === 'build') {
  const scene = EXCS.build(fs.readFileSync(file, 'utf8'));
  const out = outFile ?? file.replace(/\.excs$/, '.excalidraw');
  fs.writeFileSync(out, JSON.stringify(scene, null, 2) + '\n');
  console.log(`wrote ${scene.elements.length} elements -> ${out}`);
} else if (cmd === 'check') {
  process.exit(check(file) ? 1 : 0);
} else if (cmd === 'preview') {
  preview(file);
} else {
  console.error(`unknown command: ${cmd}`);
  process.exit(1);
}
