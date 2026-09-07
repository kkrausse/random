// Real guest-worker proof, not a host call to the FFI module.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Worker, MessageChannel } from 'node:worker_threads';
import { Kernel } from '../.runtime/patched/packages/kernel-host/kernel.js';
import { createKernelFs } from '../.runtime/patched/packages/kernel-host/kernel-fs.js';
const base = new URL('../.runtime/patched/scripts/', import.meta.url);
const workers = new Set();
const fsWorker = new Worker(new URL('fs-worker.mjs', base));
workers.add(fsWorker);
let onMessage = () => {};
const timeout = setTimeout(() => { console.error('FFI worker timeout'); process.exit(1); }, 30000);
await new Promise((resolve, reject) => {
  fsWorker.on('error', reject);
  fsWorker.on('message', m => m.type === 'ready' ? resolve() : onMessage(m));
});
const bridge = createKernelFs(fsWorker);
onMessage = bridge.onMessage;
let output = '';
const kernel = new Kernel({ fs: bridge.fs, stdout: s => output += s, stderr: s => output += s, spawnWorker(info) {
  const w = new Worker(new URL('process-worker.mjs', base)); workers.add(w);
  w.on('message', m => info.on[m.type]?.(m));
  w.on('error', e => { console.error(e); kernel.stop(info.pid); });
  const { port1, port2 } = new MessageChannel();
  fsWorker.postMessage({ type: 'fs-register', client: info.pid, sab: info.sab, port: port2 }, [port2]);
  w.postMessage({ type: 'init', sab: info.sab, spec: info.spec, fsPort: port1 }, [port1]);
  return { postMessage: m => w.postMessage(m), terminate() { w.terminate(); workers.delete(w); fsWorker.postMessage({ type: 'fs-unregister', client: info.pid }); } };
} });
try {
  kernel.installCoreutils(); kernel.mkdirp('/ffi-probe');
  for (const [guest, host] of [
    ['ffi-library.wasm', '../.runtime/ffi-library.wasm'],
    ['ffi-library.ffi.json', '../.runtime/ffi-library.ffi.json'],
    ['contract.cjs', '../probes/runtime/ffi-contract.cjs'],
  ]) kernel.writeFile('/ffi-probe/' + guest, new Uint8Array(readFileSync(new URL(host, import.meta.url))));
  const pid = kernel.launch('bun', ['/ffi-probe/contract.cjs'], {cwd: '/ffi-probe', env: {PATH: '/bin'}});
  while (kernel.procs.has(pid)) await new Promise(r => setTimeout(r, 10));
  console.log(output);
  assert.match(output, /FFI_CONTRACT_PASS/);
  if (process.argv.includes('--opentui')) {
    output = '';
    const receipt = JSON.parse(readFileSync(new URL('../.runtime/tui-package/receipt.json', import.meta.url), 'utf8'));
    const assets = receipt.assets.filter(x => x.target === 'node').map(x => ({path: x.destination, bytes: new Uint8Array(readFileSync(new URL('../.runtime/tui-package/' + x.file, import.meta.url)))}));
    assets.push({path: '/ffi-probe/opentui.wasm', bytes: new Uint8Array(readFileSync(new URL('../.runtime/opentui-source/packages/core/src/zig/zig-out/bin/opentui.wasm', import.meta.url)))});
    assets.push({path: '/ffi-probe/opentui.ffi.json', bytes: new Uint8Array(readFileSync(new URL('../.runtime/opentui.ffi.json', import.meta.url)))});
    await kernel.writeFilesBatch(assets);
    const tui = kernel.launch('node', ['/tui-probe/node/renderer.cjs'], {cwd: '/ffi-probe', env: {PATH: '/bin', VV_TUI_FFI_ARTIFACT: '/ffi-probe/opentui.ffi.json'}});
    while (kernel.procs.has(tui)) await new Promise(r => setTimeout(r, 10));
    console.log('ACTUAL_OPENTUI_GATE\n' + output);
    assert.match(output, /tui: imported/);
    assert.match(output, /missing export createAudioEngine/);
  }
} finally {
  clearTimeout(timeout);
  await Promise.all([...workers].map(w => w.terminate()));
}
