// Viewer interaction checks in headless Chrome. node test/viewer.mjs <viewer url with ?s=…&only=x9b>  (needs playwright-core + Chrome)
// Each check prints PASS/FAIL; exit 1 on any FAIL. Uses the x9b diagram ids (gaze-lab doc/arch/x20b/arch.js).
import { chromium } from '/home/kkrausse/.bun/install/global/node_modules/playwright-core/index.mjs';
const URL_ = process.argv[2];
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
let fails = 0; const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' :: ' + info}`); if (!ok) fails++; };
const fresh = async () => { await p.goto(URL_); await p.waitForFunction(() => typeof page !== 'undefined' && page && document.querySelector('#stage svg'), null, { timeout: 20000 }); };
// centre the view on an item (so every box the check clicks is on screen)
const view = (id, z = 0.9) => p.evaluate(([id, z]) => { const g = itemOf(id), r = stage.getBoundingClientRect(); cam = { x: g.x + g.w / 2 - r.width / 2 / z, y: g.y + g.h / 2 - r.height / 2 / z, z }; setCam(); }, [id, z]);
const centre = (id) => p.evaluate((id) => { const q = document.querySelector(`[data-id="${CSS.escape(id)}"] rect`).getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; }, id);
const drag = async ([x, y], dx, dy) => { await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + dx, y + dy, { steps: 6 }); await p.mouse.up(); };
const places = (ids) => p.evaluate((ids) => Object.fromEntries(ids.map((i) => [i, place(i)])), ids);
// every line touching `ids` ends on its box's current place (screen check against the drawn path)
const linesOk = (ids) => p.evaluate((ids) => {
  const bad = [];
  for (const e of page.items.filter((e) => e.t === 'edge' && (ids.includes(e.from) || ids.includes(e.to)))) {
    const g = document.querySelector(`[data-id="${CSS.escape(e.id)}"]`);
    const P = g.querySelector('path:last-of-type').getAttribute('d').slice(1).split('L').map((q) => q.split(',').map(Number));
    const tip = g.querySelector('polygon').getAttribute('points').split(' ')[0].split(',').map(Number);
    const on = (id, [x, y]) => { const B = place(id); return x >= B.x - 1.5 && x <= B.x + B.w + 1.5 && y >= B.y - 1.5 && y <= B.y + B.h + 1.5; };
    if (!on(e.from, P[0])) bad.push(`${e.id} start`); if (!on(e.to, tip)) bad.push(`${e.id} end`);
  }
  return bad;
}, ids);
const drawnAt = (id) => p.evaluate((id) => { const g = document.querySelector(`[data-id="${CSS.escape(id)}"]`), r = g.querySelector('rect'), t = g.getAttribute('transform');
  const m = t ? t.match(/translate\(([-\d.e]+),([-\d.e]+)\)/).slice(1).map(Number) : [0, 0]; return [+r.getAttribute('x') + m[0], +r.getAttribute('y') + m[1]]; }, id);

// 1. one box: moves, lines follow, drawn where place() says
await fresh(); check('tab title comes from title()', (await p.title()).startsWith('diagram: ') && (await p.title()).length > 'diagram: '.length + 3, await p.title());
await view('k.c.blk');
let a = await places(['k.c.blk']); await drag(await centre('k.c.blk'), 120, 40); let z = await places(['k.c.blk']);
check('drag one box moves it', Math.round(z['k.c.blk'].x - a['k.c.blk'].x) !== 0, JSON.stringify([a, z]));
let L = await linesOk(['k.c.blk']); check('its lines end on it', !L.length, L.join(', '));
let d = await drawnAt('k.c.blk'); check('drawn at place()', Math.abs(d[0] - z['k.c.blk'].x) < 0.5 && Math.abs(d[1] - z['k.c.blk'].y) < 0.5, JSON.stringify([d, z['k.c.blk']]));
// 2. outline moved, then a box inside it: moves add up, lines follow
await fresh(); await view('k.cp', 0.7);
a = await places(['k.cp', 'k.c.t']);
const title = await p.evaluate(() => { const t = [...document.querySelectorAll('[data-id="k.cp"] text')].pop().getBoundingClientRect(); return [t.x + 5, t.y + t.height / 2]; });
await drag(title, 100, 30); await drag(await centre('k.c.t'), 60, 20); z = await places(['k.cp', 'k.c.t']);
check('outline then inner box: moves add', Math.round(z['k.c.t'].x - a['k.c.t'].x) === Math.round(z['k.cp'].x - a['k.cp'].x) + Math.round(60 / 0.7) || Math.abs((z['k.c.t'].x - a['k.c.t'].x) - (z['k.cp'].x - a['k.cp'].x) - 60 / 0.7) < 2, JSON.stringify([a, z]));
L = await linesOk(['k.c.t', 'k.c.blk', 'k.c1', 'k.c.out', 'k.c.take']); check('lines inside moved outline end on their boxes', !L.length, L.join(', '));
// 3. box-select a whole outline + contents, drag: everything moves the same amount, feedback = 1 line
await fresh(); await view('k.cp', 0.7);
const R = await p.evaluate(() => { const q = document.querySelector('[data-id="k.cp"] rect:nth-of-type(4)').getBoundingClientRect(); return [q.x, q.y, q.width, q.height]; });
// start the band on empty space just above-left of the outline (a line may run right past its corner)
const S0 = await p.evaluate(([x0, y0]) => { for (let d = 20; d < 200; d += 6) for (const [x, y] of [[x0 - d, y0 - d], [x0 - d, y0 - 20], [x0 - 20, y0 - d]]) if (!document.elementFromPoint(x, y)?.closest('[data-id]')) return [x, y]; }, [R[0], R[1]]);
await p.mouse.move(S0[0], S0[1]); await p.mouse.down(); await p.mouse.move(R[0] + R[2] + 20, R[1] + R[3] + 20, { steps: 6 }); await p.mouse.up();
const ids = await p.evaluate(() => [...sel]); check('box-select picks the outline and its contents', ids.includes('k.cp') && ids.length > 5, ids.length);
a = await places(ids); await drag(await centre('k.c.t'), -250, 20); z = await places(ids);
const boxIds = await p.evaluate((ids) => ids.filter((i) => ['node', 'group'].includes(itemOf(i)?.t)), ids);  // lines change shape when one end moves
const deltas = new Set(boxIds.map((i) => `${Math.round(z[i].x - a[i].x)},${Math.round(z[i].y - a[i].y)}`));
check('multi-select drag: every box moves the same amount', deltas.size === 1, [...deltas].join(' '));
const fb = await p.evaluate(() => fbText()); check('feedback: one line for the outline', fb.split('\n').length === 1 && fb.startsWith('move k.cp'), fb);
L = await linesOk(ids); check('lines of the moved selection end on their boxes', !L.length, L.join(', '));
// 4. two unrelated boxes selected with shift: same move
await fresh(); await view('k.cp', 0.8);
await p.mouse.click(...(await centre('k.c.blk'))); await p.keyboard.down('Shift'); await p.mouse.click(...(await centre('k.c.take'))); await p.keyboard.up('Shift');
a = await places(['k.c.blk', 'k.c.take']); await drag(await centre('k.c.take'), 80, 60); z = await places(['k.c.blk', 'k.c.take']);
check('shift-select two boxes, drag: same move', Math.round(z['k.c.blk'].x - a['k.c.blk'].x) === Math.round(z['k.c.take'].x - a['k.c.take'].x) && Math.round(z['k.c.blk'].x - a['k.c.blk'].x) !== 0, JSON.stringify([a, z]));
// 5. selection outline = place(); group inside is empty space; no text highlight; R resets
const so = await p.evaluate(() => { const r = document.querySelector('.sel-box'); const q = place('k.c.blk'); return [+r.getAttribute('x') + 4 - q.x, +r.getAttribute('y') + 4 - q.y]; });
check('red outline sits on place()', Math.abs(so[0]) < 0.5 && Math.abs(so[1]) < 0.5, so);
check('no page text highlighted', (await p.evaluate(() => String(getSelection()))) === '');
await p.keyboard.press('r'); await p.waitForTimeout(2500);
check('R resets every move', (await p.evaluate(() => Object.keys(fb.moves).length)) === 0 && (await p.evaluate(() => document.querySelectorAll('[transform]').length)) === 0);
await view('k.L', 0.4);
const inside = await p.evaluate(() => { const q = place('k.L'), r = document.querySelector('#stage svg').getBoundingClientRect(), vb = document.querySelector('#stage svg').viewBox.baseVal;
  const sx = r.width / vb.width, X = (q.x + 30 - vb.x) * sx + r.x, Y = (q.y + q.h * 0.97 - vb.y) * sx + r.y; return document.elementFromPoint(X, Y)?.closest('[data-id]')?.dataset.id ?? '(empty)'; });
check('inside of an outline is empty space', inside === '(empty)' || inside !== 'k.L', inside);
// 6. shift-click to deselect then a small drag moves nothing; browser shortcuts are not ours; drag frame is fast
await fresh(); await view('k.cp', 0.8);
const c1 = await centre('k.c.blk'), c2 = await centre('k.c1');
await p.mouse.click(...c1); await p.keyboard.down('Shift'); await p.mouse.click(...c2); await drag(c2, 60, 30); await p.keyboard.up('Shift');
check('shift-click deselect + drag moves nothing', (await p.evaluate(() => Object.keys(fb.moves).length)) === 0, JSON.stringify(await p.evaluate(() => fb.moves)));
const z0 = await p.evaluate(() => cam.z); await p.keyboard.press('Control+f');
check('Ctrl+F leaves the view alone', (await p.evaluate(() => cam.z)) === z0);
const ms = await p.evaluate(() => { fb.moves = { 'k.cp': [10, 10], 'k.L': [5, 5], 'k.xx': [3, 3] }; const t = performance.now(); for (let i = 0; i < 5; i++) { fb.moves['k.cp'][0] += 1; applyMoves(); } return (performance.now() - t) / 5; });
check('a drag frame takes < 30 ms', ms < 30, ms.toFixed(1) + ' ms');
L = await linesOk(['k.c.blk', 'k.c.t', 'k.x.t', 'k.xx']); check('lines still end on boxes after fast redraws', !L.length, L.join(', '));
// 7. a missing diagram file says so
const p2 = await b.newPage(); await p2.goto(URL_.replace(/\?s=[^&]*/, '?s=file:///nonexistent/x.js')); await p2.waitForTimeout(3000);
check('missing file is reported', (await p2.evaluate(() => document.getElementById('bar').textContent)).includes('could not load'));
// 8. with a selection: press on empty space and slide moves it; a plain click there clears it; shift+drag still box-selects
await fresh(); await view('k.cp', 0.8);
await p.mouse.click(...(await centre('k.c.blk')));
a = await places(['k.c.blk']);
const emptyPt = () => p.evaluate(() => { for (let y = 120; y < 900; y += 20) for (let x = 60; x < 1500; x += 20) if (!document.elementFromPoint(x, y)?.closest('[data-id]')) return [x, y]; });
const empty = await emptyPt();
await drag(empty, 90, 50); z = await places(['k.c.blk']);
check('selection + drag on empty space moves the selection', Math.round(z['k.c.blk'].x - a['k.c.blk'].x) !== 0 && (await p.evaluate(() => sel.size)) === 1, JSON.stringify([a, z]));
L = await linesOk(['k.c.blk']); check('…and its lines follow', !L.length, L.join(', '));
const empty2 = await emptyPt(); await p.mouse.click(...empty2);  // lines moved with the selection: find empty space again
check('a plain click on empty space clears the selection', (await p.evaluate(() => sel.size)) === 0, 'under the click: ' + await p.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-id]')?.dataset.id ?? '(empty)', empty2) + ' sel=' + await p.evaluate(() => [...sel]));
await p.keyboard.press('r'); await p.waitForTimeout(2500); await view('k.cp', 0.8);  // fresh layout: nothing moved over k.c1
await p.mouse.click(...(await centre('k.c.blk'))); await p.keyboard.down('Shift');
const R2 = await p.evaluate(() => { const q = document.querySelector('[data-id="k.c1"] rect').getBoundingClientRect(); return [q.x - 10, q.y - 10, q.width + 20, q.height + 20]; });
await p.mouse.move(R2[0], R2[1]); await p.mouse.down(); await p.mouse.move(R2[0] + R2[2], R2[1] + R2[3], { steps: 4 }); await p.mouse.up(); await p.keyboard.up('Shift');
check('shift + drag on empty space adds by box-select', (await p.evaluate(() => sel.has('k.c1') && sel.has('k.c.blk'))), 'band start on: ' + await p.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-id]')?.dataset.id ?? '(empty)', [R2[0], R2[1]]) + ' sel=' + await p.evaluate(() => [...sel]));
// 9. lines are routed again around the boxes: once a drag rests (button still down) and on release
const through = (ids) => p.evaluate((ids) => {  // lines touching ids that cross a box other than their own ends
  const bad = [], boxes = page.items.filter((i) => i.t === 'node' && !i.legend);
  for (const e of page.items.filter((e) => e.t === 'edge' && (ids.includes(e.from) || ids.includes(e.to)))) {
    const P = linePts(e);
    for (const bx of boxes) { if (bx.id === e.from || bx.id === e.to) continue; const B = place(bx.id);
      for (let i = 1; i < P.length; i++) { const [x1, y1] = P[i - 1], [x2, y2] = P[i];
        if (Math.max(x1, x2) > B.x + 2 && Math.min(x1, x2) < B.x + B.w - 2 && Math.max(y1, y2) > B.y + 2 && Math.min(y1, y2) < B.y + B.h - 2) { bad.push(`${e.id} through ${bx.id}`); break; } } }
  }
  return bad;
}, ids);
await fresh(); await view('k.tb', 0.6);
const tb0 = await centre('k.tb');
await p.mouse.move(...tb0); await p.mouse.down(); await p.mouse.move(tb0[0] + 160, tb0[1] + 40, { steps: 6 });
const nHeld = await p.waitForFunction(() => page.items.filter((e) => e.t === 'edge' && (e.from === 'k.tb' || e.to === 'k.tb') && routeOf(e)).length, null, { timeout: 5000 }).then((h) => h.jsonValue()).catch(() => 0);
check('a drag held still: its lines are routed again', nHeld > 0, nHeld);
// drop it on a clear spot (a box dropped on another box has to have lines through it)
const drop = await p.evaluate(([dx0, dy0]) => { const B = place('k.tb'), z = cam.z, base = fb.moves['k.tb'] ?? [0, 0];
  const boxes = page.items.filter((i) => (i.t === 'node' || (i.t === 'group' && !(ANC.get('k.tb') ?? []).includes(i.id))) && i.id !== 'k.tb' && !i.legend).map((i) => place(i.id));
  for (let sx = -400; sx <= 400; sx += 40) for (const sy of [60, 120, -40]) { const x = B.x + (sx - dx0) / z, y = B.y + (sy - dy0) / z;
    if (!boxes.some((o) => x < o.x + o.w + 90 && o.x < x + B.w + 50 && y < o.y + o.h + 50 && o.y < y + B.h + 90)) return [sx, sy]; } }, [160, 40]);  // clear of deck cards (up / right) too
await p.mouse.move(tb0[0] + drop[0], tb0[1] + drop[1], { steps: 6 }); await p.mouse.up();
const nUp = await p.waitForFunction(() => page.items.filter((e) => e.t === 'edge' && (e.from === 'k.tb' || e.to === 'k.tb')).every((e) => routeOf(e)), null, { timeout: 5000 }).then(() => true).catch(() => false);
check('on release: all its lines routed again', nUp);
L = await linesOk(['k.tb']); check('…ending on it', !L.length, L.join(', '));
const T = await through(['k.tb']); check('…and not through other boxes', !T.length, T.join(', '));
check('…and its lines share no track with other lines', await p.evaluate(() => { const its = page.items.filter((i) => (i.t === 'edge' || i.t === 'link') && i.from).map((i) => ({ id: i.id, mine: i.from === 'k.tb' || i.to === 'k.tb', P: linePts(i) }));
  const segs = its.flatMap((e) => e.P.slice(1).map((q, i) => ({ id: e.id, mine: e.mine, a: e.P[i], b: q })));
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) { const s1 = segs[i], s2 = segs[j]; if (s1.id === s2.id || !(s1.mine || s2.mine)) continue;
    const v1 = Math.abs(s1.a[0] - s1.b[0]) < 0.5, v2 = Math.abs(s2.a[0] - s2.b[0]) < 0.5; if (v1 !== v2) continue; const k = v1 ? 0 : 1, o = 1 - k;
    if (Math.abs(s1.a[k] - s2.a[k]) > 1.5) continue; const lo = Math.max(Math.min(s1.a[o], s1.b[o]), Math.min(s2.a[o], s2.b[o])), hi = Math.min(Math.max(s1.a[o], s1.b[o]), Math.max(s2.a[o], s2.b[o]));
    if (hi - lo > 4) return false; } return true; }));
check('…drawn as routed', await p.evaluate(() => { const e = page.items.find((e) => e.t === 'edge' && e.to === 'k.tb'), g = document.querySelector(`[data-id="${CSS.escape(e.id)}"] path:last-of-type`);
  return g.getAttribute('d').split('L').length === routeOf(e).pts.length; }));
await p.keyboard.press('r'); await p.waitForTimeout(2500);
check('R drops the re-routed lines', await p.evaluate(() => routed.size === 0 && Object.keys(fb.moves).length === 0));
check('no page errors', !errs.length, errs.join(' | '));
await b.close(); process.exit(fails ? 1 : 0);
