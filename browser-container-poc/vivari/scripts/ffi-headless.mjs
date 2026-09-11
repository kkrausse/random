// Real guest-worker proof, not a host call to the FFI module.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Worker, MessageChannel } from 'node:worker_threads';
import { runtimeSourceUrl } from './runtime-source.mjs';
const { Kernel } = await import(runtimeSourceUrl('packages/kernel-host/kernel.js').href);
const { createKernelFs } = await import(runtimeSourceUrl('packages/kernel-host/kernel-fs.js').href);
const base = new URL('./', runtimeSourceUrl('scripts/process-worker.mjs'));
const workers = new Set();
const fsWorker = new Worker(new URL('fs-worker.mjs', base));
workers.add(fsWorker);
let onMessage = () => {};
const timeout = setTimeout(() => { console.error('FFI worker timeout\n' + output); process.exit(1); }, 45000);
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
  w.postMessage({ type: 'init', sab: info.sab, spec: info.spec, fsPort: port1, threadPort: info.threadPort }, info.threadPort ? [port1,info.threadPort] : [port1]);
  return { postMessage: m => w.postMessage(m), terminate() { w.terminate(); workers.delete(w); fsWorker.postMessage({ type: 'fs-unregister', client: info.pid }); } };
} });
try {
  kernel.installCoreutils(); kernel.mkdirp('/ffi-probe');
  for (const [guest, host] of [
    ['ffi-library.wasm', '../.runtime/ffi-library.wasm'],
    ['ffi-library.ffi.json', '../.runtime/ffi-library.ffi.json'],
    ['contract.cjs', '../probes/runtime/ffi-contract.cjs'],
    ['loopback-fetch.cjs', '../probes/runtime/loopback-fetch.cjs'],
    ['stream-consumers.cjs', runtimeSourceUrl('scripts/fixtures/runtime-contracts/stream-consumers.cjs')],
    ['vm-import.cjs', runtimeSourceUrl('scripts/fixtures/runtime-contracts/vm-import.cjs')],
    ['inherit-stdin.cjs', '../probes/runtime/inherit-stdin.cjs'],
    ['process-warning.cjs', runtimeSourceUrl('scripts/fixtures/runtime-contracts/process-warning.cjs')],
  ]) kernel.writeFile('/ffi-probe/' + guest, new Uint8Array(readFileSync(new URL(host, import.meta.url))));
  const pid = kernel.launch('bun', ['/ffi-probe/contract.cjs'], {cwd: '/ffi-probe', env: {PATH: '/bin'}});
  while (kernel.procs.has(pid)) await new Promise(r => setTimeout(r, 10));
  console.log(output);
  assert.match(output, /FFI_CONTRACT_PASS/);
  output='';
  const fetchPid=kernel.launch('node',['/ffi-probe/loopback-fetch.cjs'],{cwd:'/ffi-probe',env:{PATH:'/bin'}});
  while(kernel.procs.has(fetchPid)) await new Promise(r=>setTimeout(r,10));
  console.log(output);assert.match(output,/LOOPBACK_FETCH_PASS/);
  output='';
  const consumerPid=kernel.launch('node',['/ffi-probe/stream-consumers.cjs'],{cwd:'/ffi-probe',env:{PATH:'/bin'}});
  while(kernel.procs.has(consumerPid))await new Promise(r=>setTimeout(r,10));
  console.log(output);assert.match(output,/STREAM_CONSUMERS_PASS/);
  output='';
  const vmPid=kernel.launch('node',['/ffi-probe/vm-import.cjs'],{cwd:'/ffi-probe',env:{PATH:'/bin'}});
  while(kernel.procs.has(vmPid))await new Promise(r=>setTimeout(r,10));
  console.log(output);assert.match(output,/VM_IMPORT_PASS/);
  output='';
  const warningPid=kernel.launch('node',['/ffi-probe/process-warning.cjs'],{cwd:'/ffi-probe',env:{PATH:'/bin'}});
  while(kernel.procs.has(warningPid))await new Promise(r=>setTimeout(r,10));
  console.log(output);assert.match(output,/PROCESS_WARNING_PASS/);
  output='';
  const inheritPid=kernel.launch('sh',[],{cwd:'/ffi-probe',env:{PATH:'/bin',VV_RUN:'node /ffi-probe/inherit-stdin.cjs'}});
  while(!output.includes('INHERIT_READY')&&kernel.procs.has(inheritPid))await new Promise(r=>setTimeout(r,10));
  kernel.sendStdin(inheritPid,'hello €\r');
  while(!output.includes('INHERIT_STDIN_PASS')&&kernel.procs.has(inheritPid))await new Promise(r=>setTimeout(r,10));
  kernel.stop(inheritPid);
  console.log(output);assert.match(output,/INHERIT_CHILD hello €/);assert.match(output,/INHERIT_STDIN_PASS/);
  if(process.argv.includes('--text-scratch')){
    for(const [guest,host] of [
      ['opentui.wasm','../.runtime/opentui-source/packages/core/src/zig/zig-out/bin/opentui.wasm'],
      ['opentui.ffi.json','../.runtime/opentui.ffi.json'],
      ['text-scratch.cjs','../probes/runtime/text-scratch.cjs'],
      ['text-scratch-adapters.cjs','../.runtime/text-scratch-adapters.cjs'],
    ])await kernel.writeFilesBatch([{path:'/ffi-probe/'+guest,bytes:new Uint8Array(readFileSync(new URL(host,import.meta.url)))}]);
    output='';const pid=kernel.launch('bun',['/ffi-probe/text-scratch.cjs'],{cwd:'/ffi-probe',env:{PATH:'/bin'}});
    while(kernel.procs.has(pid))await new Promise(r=>setTimeout(r,10));
    console.log(output);assert.match(output,/TEXT_SCRATCH_PASS/);
  }
  if (process.argv.includes('--v2')) {
    const receipt=JSON.parse(readFileSync(new URL('../.runtime/opencode-v2-package/receipt.json',import.meta.url),'utf8'));
    await kernel.writeFilesBatch(receipt.assets.map(a=>({path:a.destination,bytes:new Uint8Array(readFileSync(new URL('../.runtime/opencode-v2-package/'+a.file,import.meta.url)))})));
    output='';
    const pid=kernel.launch('bun',['/opencode-v2/cli/entry.cjs','--help'],{cwd:'/workspace',env:{PATH:'/bin',HOME:'/home/user',XDG_CONFIG_HOME:'/home/user/.config',XDG_DATA_HOME:'/home/user/.local/share',XDG_STATE_HOME:'/home/user/.local/state'}});
    while(kernel.procs.has(pid))await new Promise(r=>setTimeout(r,10));
    console.log('V2_HELP_GATE\n'+output);
    assert.doesNotMatch(output,/OPENCODE_SOURCE_FAILED/);
    assert.match(output,/USAGE/);
    if(process.argv.includes('--v2-server')) {
      output='';
      const server=kernel.launch('bun',['/opencode-v2/cli/entry.cjs','serve','--service','--port','4106'],{cwd:'/workspace',env:{PATH:'/bin',HOME:'/home/user',XDG_CONFIG_HOME:'/home/user/.config',XDG_DATA_HOME:'/home/user/.local/share',XDG_STATE_HOME:'/home/user/.local/state',OPENCODE_DISABLE_MODELS_FETCH:'1',OPENCODE_DISABLE_FFF:'1'}});
      const deadline=Date.now()+15000;
      while(kernel.procs.has(server)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
      console.log('V2_SERVER_DIAGNOSTIC\n'+output);
      try { console.log(kernel.readFile('/home/user/.local/share/opencode/log/opencode.log').split('\n').filter(l=>/error|failed|starting|database/i.test(l)).join('\n')); } catch {}
      kernel.stop(server);
    }
  }
  if (process.argv.includes('--opentui')) {
    output = '';
    const receipt = JSON.parse(readFileSync(new URL('../.runtime/tui-package/receipt.json', import.meta.url), 'utf8'));
    const assets = receipt.assets.filter(x => x.target === 'node').map(x => ({path: x.destination, bytes: new Uint8Array(readFileSync(new URL('../.runtime/tui-package/' + x.file, import.meta.url)))}));
    assets.push({path: '/ffi-probe/opentui.wasm', bytes: new Uint8Array(readFileSync(new URL('../.runtime/opentui-source/packages/core/src/zig/zig-out/bin/opentui.wasm', import.meta.url)))});
    assets.push({path: '/ffi-probe/opentui.ffi.json', bytes: new Uint8Array(readFileSync(new URL('../.runtime/opentui.ffi.json', import.meta.url)))});
    assets.push({path: '/ffi-probe/reject.cjs', bytes: new Uint8Array(readFileSync(new URL('../probes/runtime/opentui-wire-reject.cjs', import.meta.url)))});
    await kernel.writeFilesBatch(assets);
    const tui = kernel.launch('node', ['/tui-probe/node/renderer.cjs'], {cwd: '/ffi-probe', env: {PATH: '/bin', VV_TUI_FFI_ARTIFACT: '/ffi-probe/opentui.ffi.json'}});
    for (let cycle = 1; cycle <= 2; cycle++) {
      const ready = () => { try { return kernel.readFile('/ffi-probe/tui-trace.jsonl').includes(`tui: render requested ${cycle}`); } catch { return false; } };
      while (!ready() && kernel.procs.has(tui)) await new Promise(r => setTimeout(r, 10));
      await new Promise(r => setTimeout(r, 200));
      kernel.sendStdin(tui, 'hello');
      await new Promise(r => setTimeout(r, 200));
      kernel.sendStdin(tui, 'q');
    }
    while (kernel.procs.has(tui)) await new Promise(r => setTimeout(r, 10));
    console.log('ACTUAL_OPENTUI_GATE\n' + output);
    assert.match(output, /tui: imported/);
    assert.match(output, /TUI_LIFECYCLE_PASS/);
    assert.match(output, /input hello cycle 1/);
    assert.match(output, /input hello cycle 2/);
    assert.doesNotMatch(output, /panic:|tui: failed|aborting/);
    assert.match(output, /TUI_ABI_PASS/);
    for (const mode of ['wide', 'range', 'audio']) {
      output = '';
      const pid = kernel.launch('node', ['/ffi-probe/reject.cjs', mode], {cwd:'/ffi-probe', env:{PATH:'/bin'}});
      while (kernel.procs.has(pid)) await new Promise(r=>setTimeout(r,10));
      console.log(output);
      assert.match(output, new RegExp('WIRE_REJECTION_PASS ' + mode));
    }
    if (process.argv.includes('--opencode')) {
      const receipt = JSON.parse(readFileSync(new URL('../.runtime/opencode-tui-package/receipt.json', import.meta.url),'utf8'));
      await kernel.writeFilesBatch(receipt.assets.map(a=>({path:a.destination,bytes:new Uint8Array(readFileSync(new URL('../.runtime/opencode-tui-package/'+a.file,import.meta.url)))})));
      for (const mode of ['server','cli','app']) {
        output='';
        const args=mode==='server'?['/opencode-tui/cli/entry.cjs','serve','--port','4096','--register']:[`/opencode-tui/${mode}/entry.cjs`];
        const pid=kernel.launch('node',args,{cwd:'/workspace',env:{PATH:'/bin',HOME:'/home/user',XDG_CONFIG_HOME:'/home/user/.config',XDG_DATA_HOME:'/home/user/.local/share',XDG_STATE_HOME:'/home/user/.local/state',VV_TRACE_MODULES:'1'}});
        const deadline=Date.now()+10000;
        while(kernel.procs.has(pid)&&Date.now()<deadline && !(mode==='server' && output.includes('server listening'))) await new Promise(r=>setTimeout(r,10));
        const timedOut=kernel.procs.has(pid);
        if(timedOut && mode!=='server') kernel.stop(pid);
        console.log(`OPENCODE_SOURCE_RESULT ${mode} timedOut=${timedOut}\n`+output);
      }
    }
  }
} finally {
  clearTimeout(timeout);
  await Promise.all([...workers].map(w => w.terminate()));
}
