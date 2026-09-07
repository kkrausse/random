import { Vivari } from '../.artifacts/fixed-runtime/index.js';
import runtimeBuild from '../runtime-build.json';
import { commitSnapshot, decodeSnapshot, snapshotCommand, sha256 } from './sync';
const $ = (id: string) => document.getElementById(id) as any;
const preview = $('preview') as HTMLIFrameElement;
const linux = $('linux-frame') as HTMLIFrameElement;
const samples: any[] = [], logs: string[] = [];
let vm: any, bridge: any, service: any, busy = false, sequence = 0, serviceStartedAt = 0;
const log = (text: string) => { logs.push(text); if (logs.length > 1000) logs.shift(); $('log').textContent = logs.join(''); };
const mark = (phase: string, start: number, extra = {}) => { const sample = { phase, ms: performance.now() - start, ...extra }; samples.push(sample); log(JSON.stringify(sample) + '\n'); return sample; };
async function run(argv: string[], wait = true) {
  if (!vm) throw Error('Boot accelerator first');
  const start = performance.now(), proc = await vm.spawn(argv[0], argv.slice(1), { cwd: '/workspace' });
  const drain = (async () => { for await (const text of proc.output) log(text); })();
  void drain.catch(error => { log(String(error)); proc.kill(); });
  if (!wait) return proc;
  const code = await proc.exit; await drain; mark(argv.join(' '), start, { code });
  if (code !== 0) throw Error(`Worker command exit ${code}`);
}
async function boot() {
  if (vm) throw Error('Accelerator already booted');
  const start = performance.now(); vm = await Vivari.boot();
  for (const type of ['vv-ws', 'vv-sse']) vm.bridge.on(type, (event: any) => {
    preview.contentWindow?.postMessage({ ...event.msg, type, dir: 'in' }, location.origin);
    if (type === 'vv-ws') samples.push({ phase: 'worker-ws', at: performance.now(), message: event.msg });
  });
  vm.on('server-ready', (port: number, url: string) => {
    if (port === 5173) {
      preview.src = url; $('service').textContent = `Accelerator: Vite serving in browser worker (${port})`;
      if (serviceStartedAt) mark('vite-server-ready', serviceStartedAt);
      const started = serviceStartedAt, deadline = performance.now() + 60000;
      const observe = () => {
        if (preview.contentDocument?.querySelector('h1')?.getBoundingClientRect().height) mark('vite-first-visible', started);
        else if (performance.now() < deadline) requestAnimationFrame(observe);
      };
      if (started) requestAnimationFrame(observe);
    }
  });
  vm.on('error', (e: any) => log(`Kernel error: ${e.message}\n`));
  if (!await vm.fs.exists('/workspace/package.json')) {
    const files = await (await fetch('/fixture.json')).json();
    for (const [path, contents] of Object.entries(files)) await vm.fs.writeFile('/workspace/' + path, contents);
  }
  mark('worker-boot-and-fixture', start);
}
async function loadDependencies() {
  if (!vm || service) throw Error('Boot accelerator and stop Vite before loading dependencies');
  const start = performance.now(), response = await fetch('/deps-manifest.json');
  if (!response.ok) throw Error('No prebaked worker dependency pack. Install once, start Vite, then run scripts/capture-deps.js');
  const manifest = await response.json();
  if (runtimeBuild.files.filter(entry => entry.name.endsWith('.js')).some(entry => !manifest.runtimeBuild.files.some((other: any) => other.name === entry.name && other.sha256 === entry.sha256)))
    throw Error('Dependency pack was prepared for a different accelerator runtime');
  if (manifest.workspace !== '/workspace' || await sha256(await vm.fs.readFile('/workspace/package.json')) !== manifest.fixturePackageSha256)
    throw Error('Dependency pack does not match this workspace');
  const compressed = new Uint8Array(await (await fetch('/vendor/hybrid-deps.bin')).arrayBuffer());
  if (await sha256(compressed) !== manifest.sha256) throw Error('Dependency archive hash mismatch');
  const files = JSON.parse(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
  const decoded: Record<string, Uint8Array> = {};
  for (const [path, encoded] of Object.entries(files)) {
    if ((!path.startsWith('node_modules/') && path !== 'package-lock.json') || path.split('/').includes('..')) throw Error('Invalid dependency path');
    decoded[path] = Uint8Array.from(atob(encoded as string), c => c.charCodeAt(0));
  }
  // Pinned SDK kernel protocol: one transferable batch avoids the 1 MiB syscall window.
  const result = await vm.bridge.request('vv-create-project', { dir: '/workspace', files: decoded });
  if (!result.ok) throw Error(result.error);
  mark('load-prebaked-worker-dependencies', start, { bytes: compressed.length, files: Object.keys(decoded).length });
}
async function installDependencies() {
  if (!vm || service) throw Error('Boot accelerator and stop Vite before installing dependencies');
  const lock = await fetch('/worker-package-lock.json');
  if (!lock.ok) throw Error('Missing qualified worker package lock');
  await vm.fs.writeFile('/workspace/package-lock.json', await lock.text());
  return run(['npm', 'ci', '--no-audit', '--no-fund']);
}
async function connect() {
  const frame = linux.contentWindow as any;
  if (!frame.Module?.pty) throw Error('Start Linux and wait for shell prompt first');
  const start = performance.now();
  bridge = (window as any).installSerialBridge(frame.Module.pty, frame);
  await bridge.connect(await (await fetch('/guest-bridge.ts')).text());
  // xterm-pty reports [columns, rows]; the reused bridge's initial-open path
  // interprets these in reverse. Correct the guest PTY once it is connected.
  const size = frame.Module.pty.ioctl('TIOCGWINSZ');
  bridge.resizeTerminal(size[0], size[1]);
  mark('linux-bridge-connect', start);
}
async function exec(command: string) {
  if (!bridge) throw Error('Connect Linux PTY bridge first');
  const response = await bridge.request({ type: 'exec', command });
  if (response.error || response.code !== 0) throw Error(response.error || `Linux exit ${response.code}: ${response.stderr}`);
  return response;
}
async function sync() {
  if (!vm) throw Error('Boot accelerator first');
  const start = performance.now();
  const snapshot = decodeSnapshot((await exec(snapshotCommand)).stdout);
  const captured = performance.now();
  const receipt = await commitSnapshot(vm.fs, snapshot, ++sequence);
  return mark('linux-save-sync', start, { ...receipt, captureMs: captured - start });
}
async function start() {
  if (service) throw Error('Vite accelerator already running');
  serviceStartedAt = performance.now();
  await sync();
  service = await run(['node', 'node_modules/vite/bin/vite.js', '--host', '0.0.0.0', '--port', '5173', '--strictPort'], false);
  const current = service;
  $('service').textContent = 'Accelerator: Vite starting in browser worker';
  void current.exit.then((code: number) => { if (service === current) { service = undefined; $('service').textContent = `Accelerator: stopped (${code})`; } });
}
async function stop() { if (service) { const current = service; current.kill(); await current.exit; } }
async function action(fn: () => Promise<any>) {
  if (busy) throw Error('Hybrid operation in progress');
  busy = true; $('status').textContent = 'Working…';
  try { const result = await fn(); $('status').textContent = 'Ready'; return result; }
  catch (e) { $('status').textContent = String(e); log(String(e) + '\n'); throw e; }
  finally { busy = false; }
}
for (const [id, fn] of Object.entries({ linux: async () => {
  if (linux.getAttribute('src')) throw Error('Linux already started; reload discards its overlay');
  samples.push({ phase: 'linux-start', at: performance.now() }); linux.src = '/runtime.html';
  const started = performance.now(); let login = false;
  const observer = setInterval(() => {
    const text = linux.contentDocument?.body?.innerText || '';
    if (!login && text.includes('demo login:')) { login = true; mark('linux-login-ready', started); }
    if (text.includes('demo:/workspace#')) { mark('linux-shell-ready', started); clearInterval(observer); }
  }, 100);
  setTimeout(() => clearInterval(observer), 240000);
}, connect, boot, deps: loadDependencies, install: installDependencies, start, stop, sync })) {
  $(id).onclick = () => { void action(fn).catch(() => {}); };
}
$('command').onsubmit = (e: Event) => { e.preventDefault(); void action(async () => {
  const result = await exec($('cmd').value); log(result.stdout + result.stderr + `Linux command exit: ${result.code}\n`);
}).catch(() => {}); };
window.addEventListener('message', e => { if (e.source === linux.contentWindow && e.origin === location.origin && e.data?.source === 'qemu-runtime') log(JSON.stringify(e.data) + '\n'); });
Object.assign(window, { hybrid: { get vm() { return vm; }, get bridge() { return bridge; }, get service() { return service; },
  samples, logs, exec, sync: () => action(sync), start: () => action(start), stop, run, boot: () => action(boot), loadDependencies: () => action(loadDependencies) } });
