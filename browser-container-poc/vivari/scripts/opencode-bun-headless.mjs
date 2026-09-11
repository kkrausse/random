// Bounded conventional-build probe; isolation/worker lifecycle follows opencode-direct-headless.mjs.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Worker, MessageChannel } from 'node:worker_threads';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { runtimeSourceUrl } from './runtime-source.mjs';
const { Kernel } = await import(runtimeSourceUrl('packages/kernel-host/kernel.js'));
const { createKernelFs } = await import(runtimeSourceUrl('packages/kernel-host/kernel-fs.js'));
const source = fileURLToPath(new URL('../.runtime/opencode-v2-source', import.meta.url));
const output = fileURLToPath(new URL('../.runtime/opencode-bun-server', import.meta.url));
console.log(JSON.stringify({ checkpoint: 'OPENCODE_BUN_INPUT',
  revision: execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceStatus: execFileSync('git', ['-C', source, 'status', '--short'], { encoding: 'utf8' }).trim(),
  lockSha256: createHash('sha256').update(readFileSync(resolve(source, 'bun.lock'))).digest('hex'),
  runtimeRevision: execFileSync('git', ['-C', fileURLToPath(runtimeSourceUrl('.')), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  artifact: 'vanilla bun build --target=bun; emitted JS and assets', consumerBehavioralRewrites: 0,
}));
const workers = new Set();
const workerErrors = [];
const deadline = setTimeout(() => { console.error('OPENCODE_BUN_TIMEOUT'); process.exit(124); }, 180000);
try {
  const fsWorker = new Worker(runtimeSourceUrl('scripts/fs-worker.mjs'));
  workers.add(fsWorker);
  let dispatch = () => {};
  await new Promise((done, reject) => {
    fsWorker.once('error', reject);
    fsWorker.on('message', m => m.type === 'ready' ? done() : dispatch(m));
  });
  const bridge = createKernelFs(fsWorker);
  dispatch = bridge.onMessage;
  const kernel = new Kernel({ fs: bridge.fs, stdout: s => process.stdout.write(s), stderr: s => process.stderr.write(s), spawnWorker(info) {
    const worker = new Worker(runtimeSourceUrl('scripts/process-worker.mjs'));
    workers.add(worker);
    worker.on('message', m => info.on[m.type]?.(m));
    worker.on('error', e => { workerErrors.push(e.stack || String(e)); console.error(e); kernel.stop(info.pid); });
    const { port1, port2 } = new MessageChannel();
    fsWorker.postMessage({ type: 'fs-register', client: info.pid, sab: info.sab, port: port2 }, [port2]);
    worker.postMessage({ type: 'init', sab: info.sab, spec: info.spec, fsPort: port1 }, [port1]);
    return { postMessage: m => worker.postMessage(m), terminate() {
      void worker.terminate();
      fsWorker.postMessage({ type: 'fs-unregister', client: info.pid });
    } };
  } });
  kernel.installCoreutils();
  // Copy every ordinary emitted file, including the four Bun-emitted WASM assets.
  for (const entry of readdirSync(output, { withFileTypes: true })) {
    if (!entry.isFile()) throw new Error(`Unexpected build output: ${entry.name}`);
    const bytes = readFileSync(resolve(output, entry.name));
    await kernel.writeFilesBatch([{ path: '/app/' + entry.name, bytes }]);
    console.log(JSON.stringify({ checkpoint: 'OPENCODE_BUN_MOUNT', file: entry.name,
      bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }));
  }
  kernel.mkdirp('/home/direct');
  console.log('OPENCODE_BUN_COMMAND bun /app/server.js');
  kernel.onListen = port => console.log(`OPENCODE_BUN_LISTEN ${port}`);
  const result = await kernel.start('bun', ['/app/server.js'], { cwd: '/app', env: {
    PATH: '/bin', HOME: '/home/direct', OPENCODE_PASSWORD: 'isolated-probe-only',
    OPENCODE_DISABLE_FFF: '1', OPENCODE_DISABLE_FILEWATCHER: '1', OPENCODE_DISABLE_MODELS_FETCH: '1',
  }, capture: true });
  console.log(JSON.stringify({ checkpoint: 'OPENCODE_BUN_EXIT', workerErrors, ...result }, null, 2));
  process.exitCode = result.code || 1; // Exit zero alone is never server acceptance.
} finally {
  await Promise.all([...workers].map(w => w.terminate()));
  clearTimeout(deadline);
}
