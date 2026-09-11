// Diagnostic source image: byte-preserving JS/TS/JSON delivery, no dependency audit/bundle.
import { readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
import { Worker, MessageChannel } from 'node:worker_threads';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { runtimeSourceUrl } from './runtime-source.mjs';
const { Kernel } = await import(runtimeSourceUrl('packages/kernel-host/kernel.js'));
const { createKernelFs } = await import(runtimeSourceUrl('packages/kernel-host/kernel-fs.js'));
const source = resolve(process.env.OPENCODE_SOURCE || fileURLToPath(new URL('../.runtime/opencode-v2-source', import.meta.url)));
console.log(JSON.stringify({ checkpoint: 'OPENCODE_DIRECT_INPUT',
  revision: execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceStatus: execFileSync('git', ['-C', source, 'status', '--short'], { encoding: 'utf8' }).trim(),
  lockSha256: createHash('sha256').update(readFileSync(resolve(source, 'bun.lock'))).digest('hex'),
  extensions: '[cm]?[jt]sx?, json, jsonc', consumerSourceTransforms: 0,
}));
const workers = new Set();
const workerErrors = [];
const deadline = setTimeout(() => { console.error('OPENCODE_DIRECT_TIMEOUT'); process.exit(124); }, 180000);
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
  let batch = [], bytes = 0, count = 0;
  const links = [];
  async function flush() {
    if (batch.length) await kernel.writeFilesBatch(batch);
    batch = []; bytes = 0;
  }
  async function mount(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const host = resolve(dir, entry.name);
      const guest = '/upstream/' + relative(source, host);
      if (entry.isSymbolicLink()) { links.push([guest, readlinkSync(host)]); continue; }
      if (entry.isDirectory()) { await mount(host); continue; }
      if (!/\.(?:[cm]?[jt]sx?|json|jsonc)$/.test(entry.name)) continue;
      const data = readFileSync(host);
      batch.push({ path: guest, bytes: data }); bytes += data.byteLength; count++;
      if (bytes > 8 * 1024 * 1024) await flush();
    }
  }
  await mount(source); await flush();
  await kernel.writeFilesBatch([{ path: '/opencode-direct-links.json', contents: JSON.stringify(links.map(([guest, target]) => [guest,
    target.startsWith(source + '/') ? '/upstream/' + relative(source, target) : target])) }]);
  kernel.writeFile('/opencode-direct-links.cjs', `const fs = require('node:fs');
for (const [path, target] of JSON.parse(fs.readFileSync('/opencode-direct-links.json', 'utf8'))) {
  fs.mkdirSync(require('node:path').dirname(path), { recursive: true });
  fs.symlinkSync(target, path);
}
console.log('DIRECT_LINKS_DONE');`);
  const linked = await kernel.start('node', ['/opencode-direct-links.cjs'], { cwd: '/', env: { PATH: '/bin' }, capture: true });
  if (linked.code || !linked.stdout.includes('DIRECT_LINKS_DONE')) throw new Error(JSON.stringify(linked));
  console.log(`OPENCODE_DIRECT_MOUNT files=${count} symlinks=${links.length}`);
  kernel.mkdirp('/home/direct');
  const launcher = '/upstream/packages/cli/opencode-direct-launch.mjs';
  kernel.writeFile(launcher, `import { Effect } from 'effect';\nimport { ServerProcess } from '@opencode-ai/cli/server-process';\nawait Effect.runPromise(ServerProcess.run({ mode: 'default', hostname: '127.0.0.1', port: 4096 }));\n`);
  const entry = process.argv.includes('--cli') ? '/upstream/packages/cli/src/index.ts' : launcher;
  const args = process.argv.includes('--cli') ? [entry, 'serve', '--hostname', '127.0.0.1', '--port', '4096'] : [entry];
  console.log('OPENCODE_DIRECT_COMMAND bun ' + args.join(' '));
  kernel.onListen = port => console.log(`OPENCODE_DIRECT_LISTEN ${port}`);
  const result = await kernel.start('bun', args, { cwd: '/upstream/packages/cli', env: {
    PATH: '/bin', HOME: '/home/direct', OPENCODE_PASSWORD: 'isolated-probe-only',
    OPENCODE_DISABLE_FFF: '1', OPENCODE_DISABLE_FILEWATCHER: '1', OPENCODE_DISABLE_MODELS_FETCH: '1',
  }, capture: true });
  console.log(JSON.stringify({ checkpoint: 'OPENCODE_DIRECT_EXIT', workerErrors, ...result }, null, 2));
  process.exitCode = result.code || 1; // Exit zero alone is never server acceptance.
} finally {
  await Promise.all([...workers].map(w => w.terminate()));
  clearTimeout(deadline);
}
