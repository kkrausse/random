const fs = require('node:fs');
const { WASI } = require('node:wasi');
const assert = require('node:assert/strict');
console.log('wasm: loading');
const wasi = new WASI({ version: 'preview1', env: { TERM: 'xterm-256color' }, preopens: {} });
const mod = new WebAssembly.Module(fs.readFileSync('/wasm-tui/opentui.wasm'));
const instance = new WebAssembly.Instance(mod, wasi.getImportObject());
console.log('wasm: instantiated');
wasi.initialize(instance);
console.log('wasm: initialized');
const lib = instance.exports;
assert.equal(lib.createAudioEngine, undefined);
const allocations = [];
function alloc(n) { const p = lib.wasmAlloc(n); assert.ok(p); allocations.push([p,n]); return p; }
const text = alloc(4096), fg = alloc(8), bg = alloc(8);
new Uint16Array(lib.memory.buffer, fg, 4).set([65535,65535,65535,65535]);
new Uint16Array(lib.memory.buffer, bg, 4).set([0,0,0,65535]);
const renderer = lib.createRenderer(process.stdout.columns, process.stdout.rows, 0, 1, 0);
console.log('wasm: renderer',renderer);
assert.ok(renderer);
const edit = lib.createEditBuffer(0, 0);
assert.ok(edit);
function insert(s) {
  const b = Buffer.from(s); assert.ok(b.length < 4096);
  new Uint8Array(lib.memory.buffer, text, b.length).set(b);
  lib.editBufferInsertChar(edit, text, b.length);
}
function paint() {
  const n = lib.editBufferGetText(edit, text, 4096);
  const buffer = lib.getNextBuffer(renderer);
  lib.bufferClear(buffer, bg);
  lib.bufferDrawText(buffer, text, n, 0, 0, fg, bg, 0);
  assert.equal(lib.render(renderer, true), 0);
}
insert('Real OpenTUI WASM: ');
console.log('wasm: text inserted');
lib.setupTerminal(renderer, true);
paint();
process.stdout.on('resize', () => {
  lib.resizeRenderer(renderer, process.stdout.columns, process.stdout.rows);
  paint();
});
process.stdin.on('data', chunk => {
  const s = chunk.toString();
  if (s === 'q') {
    const n = lib.editBufferGetText(edit, text, 4096);
    const value = Buffer.from(new Uint8Array(lib.memory.buffer, text, n)).toString();
    lib.destroyEditBuffer(edit);
    lib.destroyRenderer(renderer);
    for (const [p,n] of allocations) lib.wasmFree(p,n);
    console.log('WASM_CORE_PASS '+JSON.stringify({ value, cols: process.stdout.columns, rows: process.stdout.rows }));
    process.exit(0);
  }
  if (/^[a-zA-Z ]+$/.test(s)) { insert(s); paint(); }
});
