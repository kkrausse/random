// Viewer interaction checks in headless Chrome. node test/viewer.mjs <viewer url with ?s=…&only=x9b>  (needs playwright-core + Chrome)
// Each check prints PASS/FAIL; exit 1 on any FAIL. Uses the x9b diagram ids (gaze-lab doc/arch/x20b/arch.js).
import { chromium } from '/home/kkrausse/.bun/install/global/node_modules/playwright-core/index.mjs';
const URL_ = process.argv[2];
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
let fails = 0; const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' :: ' + info}`); if (!ok) fails++; };
const fresh = async () => { await p.goto(URL_); await p.waitForFunction(() => typeof page !== 'undefined' && page && document.querySelector('#stage svg'), null, { timeout: 20000 }); };
const view = (id, z = 0.9) => p.evaluate(([id, z]) => { const g = itemOf(id); cam = { x: g.x - 150, y: g.y - 120, z }; setCam(); }, [id, z]);
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
await fresh(); await view('k.c.blk');
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
await fresh(); await view('k.tb');
const R = await p.evaluate(() => { const q = document.querySelector('[data-id="k.tb"] rect').getBoundingClientRect(); return [q.x, q.y, q.width, q.height]; });
await p.mouse.move(R[0] - 20, R[1] - 20); await p.mouse.down(); await p.mouse.move(R[0] + R[2] + 20, R[1] + R[3] + 20, { steps: 6 }); await p.mouse.up();
const ids = await p.evaluate(() => [...sel]); check('box-select picks the outline and its contents', ids.includes('k.tb') && ids.length > 5, ids.length);
a = await places(ids); await drag(await centre('k.x.m'), -250, 20); z = await places(ids);
const deltas = new Set(ids.map((i) => `${Math.round(z[i].x - a[i].x)},${Math.round(z[i].y - a[i].y)}`));
check('multi-select drag: every item moves the same amount', deltas.size === 1, [...deltas].join(' '));
const fb = await p.evaluate(() => fbText()); check('feedback: one line for the outline', fb.split('\n').length === 1 && fb.startsWith('move k.tb'), fb);
L = await linesOk(ids); check('lines of the moved selection end on their boxes', !L.length, L.join(', '));
// 4. two unrelated boxes selected with shift: same move
await fresh(); await view('k.c.blk', 0.5);
await p.mouse.click(...(await centre('k.c.blk'))); await p.keyboard.down('Shift'); await p.mouse.click(...(await centre('k.x.m'))); await p.keyboard.up('Shift');
a = await places(['k.c.blk', 'k.x.m']); await drag(await centre('k.x.m'), 80, 60); z = await places(['k.c.blk', 'k.x.m']);
check('shift-select two boxes, drag: same move', Math.round(z['k.c.blk'].x - a['k.c.blk'].x) === Math.round(z['k.x.m'].x - a['k.x.m'].x) && Math.round(z['k.c.blk'].x - a['k.c.blk'].x) !== 0, JSON.stringify([a, z]));
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
const ms = await p.evaluate(() => { fb.moves = { 'k.cp': [10, 10], 'k.tb': [5, 5], 'k.xx': [3, 3] }; const t = performance.now(); for (let i = 0; i < 5; i++) { fb.moves['k.cp'][0] += 1; applyMoves(); } return (performance.now() - t) / 5; });
check('a drag frame takes < 30 ms', ms < 30, ms.toFixed(1) + ' ms');
L = await linesOk(['k.c.blk', 'k.c.t', 'k.x.m', 'k.xx']); check('lines still end on boxes after fast redraws', !L.length, L.join(', '));
// 7. a missing diagram file says so
const p2 = await b.newPage(); await p2.goto(URL_.replace(/\?s=[^&]*/, '?s=file:///nonexistent/x.js')); await p2.waitForTimeout(3000);
check('missing file is reported', (await p2.evaluate(() => document.getElementById('bar').textContent)).includes('could not load'));
check('no page errors', !errs.length, errs.join(' | '));
await b.close(); process.exit(fails ? 1 : 0);
