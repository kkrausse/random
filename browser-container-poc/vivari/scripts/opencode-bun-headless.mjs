// Bounded conventional-build probe; isolation/worker lifecycle follows opencode-direct-headless.mjs.
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
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
const directory = mkdtempSync(fileURLToPath(new URL('../.runtime/opencode-headless-storage-', import.meta.url)));
console.log(JSON.stringify({ checkpoint: 'OPENCODE_BUN_STORAGE', directory,
  adapter: 'sqlite-headless-fs disk snapshots; restart coverage, not OPFS/power-loss qualification',
  database: '/runtime-probe/opencode.sqlite' }));
console.log(JSON.stringify({ checkpoint: 'OPENCODE_BUN_INPUT',
  revision: execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceStatus: execFileSync('git', ['-C', source, 'status', '--short'], { encoding: 'utf8' }).trim(),
  lockSha256: createHash('sha256').update(readFileSync(resolve(source, 'bun.lock'))).digest('hex'),
  runtimeRevision: execFileSync('git', ['-C', fileURLToPath(runtimeSourceUrl('.')), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  artifact: 'Bun.build target=node; published jsonc-parser ESM entry selection; emitted files plus original tree-sitter WASM assets', consumerBehavioralRewrites: 0,
}));
const workers = new Set();
const service = process.argv.includes('--service');
let servicePassed = false;
let serviceFailed = false;
const workerErrors = [];
const deadline = setTimeout(() => { console.error('OPENCODE_BUN_TIMEOUT'); process.exit(124); }, 180000);
try {
  const fsWorker = new Worker(new URL('./sqlite-headless-fs.mjs', import.meta.url), { workerData: { directory } });
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
  // Mount build output unchanged, including explicitly copied runtime data assets.
  for (const entry of readdirSync(output, { withFileTypes: true })) {
    if (!entry.isFile()) throw new Error(`Unexpected build output: ${entry.name}`);
    const bytes = readFileSync(resolve(output, entry.name));
    await kernel.writeFilesBatch([{ path: '/app/' + entry.name, bytes }]);
    console.log(JSON.stringify({ checkpoint: 'OPENCODE_BUN_MOUNT', file: entry.name,
      bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }));
  }
  kernel.mkdirp('/home/direct');
  console.log('OPENCODE_BUN_COMMAND bun /app/server.js' + (service ? ' --service' : ''));
  let finished = false;
  let health;
  kernel.onListen = (port, pid) => {
    console.log(`OPENCODE_BUN_LISTEN ${port}`);
    health = (async () => {
      if (service) {
        try {
          const file = '/home/direct/state/opencode/service-local.json';
          const until = Date.now() + 30000;
          while (!kernel.exists(file) && !finished && Date.now() < until)
            await new Promise(done => setTimeout(done, 100));
          if (!kernel.exists(file)) throw new Error('Guest registration did not appear within 30 seconds');
          const info = JSON.parse(kernel.readFile(file));
          if (typeof info.password !== 'string' || !info.password || typeof info.id !== 'string' || !info.id)
            throw new Error('Guest registration missing password or id');
          if (info.url !== `http://127.0.0.1:${port}` || info.pid !== pid)
            throw new Error('Guest registration does not match listener');
          console.log(JSON.stringify({ checkpoint: 'OPENCODE_BUN_REGISTRATION', file, credentials: 'guest-generated; redacted' }));
          const headers = { host: '127.0.0.1:' + port,
            authorization: 'Basic ' + Buffer.from('opencode:' + info.password).toString('base64'),
            'content-type': 'application/json' };
          for (const route of ['health', 'stop']) {
            let timer;
            try {
              const response = await Promise.race([
                kernel.handleHttpRequest(port, { method: route === 'health' ? 'GET' : 'POST',
                  url: route === 'health' ? '/api/health' : '/api/service/stop', headers,
                  body: route === 'health' ? '' : JSON.stringify({ instanceID: info.id }) }),
                new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${route} timed out`)), 5000); }),
              ]);
              console.log(JSON.stringify({ checkpoint: 'OPENCODE_BUN_' + route.toUpperCase(), status: response.status, body: response.body }));
              if (response.status !== 200 || JSON.parse(response.body)[route === 'health' ? 'healthy' : 'accepted'] !== true)
                throw new Error(`${route} rejected`);
            } finally { clearTimeout(timer); }
          }
          servicePassed = true;
        } catch (error) {
          serviceFailed = true;
          console.error('OPENCODE_BUN_SERVICE_ERROR', String(error));
          kernel.stop(pid);
        }
        return;
      }
      const until = Date.now() + 30000;
      while (!finished && Date.now() < until) {
        let timer;
        try {
          const response = await Promise.race([
            kernel.handleHttpRequest(port, { method: 'GET', url: '/api/health', body: '',
              headers: { host: '127.0.0.1:' + port,
                authorization: 'Basic ' + Buffer.from('opencode:isolated-probe-only').toString('base64') } }),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('health request timed out')), 5000); }),
          ]);
          console.log(JSON.stringify({ checkpoint: 'OPENCODE_BUN_HEALTH', status: response.status, body: response.body }));
          if (response.status === 200 && JSON.parse(response.body).healthy === true) {
            console.log('OPENCODE_BUN_HEALTH_PASS');
            kernel.stop(pid); // Diagnostic stop; this does not qualify graceful application shutdown.
            return;
          }
        } catch (error) {
          console.log(JSON.stringify({ checkpoint: 'OPENCODE_BUN_HEALTH_ERROR', error: String(error) }));
        } finally { clearTimeout(timer); }
        if (!finished) await new Promise(done => setTimeout(done, 100));
      }
    })();
  };
  const result = await kernel.start('bun', ['/app/server.js', ...(service ? ['--service'] : [])], { cwd: '/app', env: {
    PATH: '/bin', HOME: '/home/direct', OPENCODE_PASSWORD: 'isolated-probe-only',
    ...(service ? { XDG_CONFIG_HOME: '/home/direct/config', XDG_STATE_HOME: '/home/direct/state',
      XDG_DATA_HOME: '/home/direct/data', XDG_CACHE_HOME: '/home/direct/cache',
      OPENCODE_TEST_HOME: '/home/direct', TMPDIR: '/home/direct/tmp' } : {}),
    OPENCODE_DB: '/runtime-probe/opencode.sqlite',
    OPENCODE_DISABLE_FFF: '1', OPENCODE_DISABLE_FILEWATCHER: '1', OPENCODE_DISABLE_MODELS_FETCH: '1',
    OPENCODE_TREE_SITTER_WASM_PATH: '/app/tree-sitter.wasm',
    OPENCODE_TREE_SITTER_BASH_WASM_PATH: '/app/tree-sitter-bash.wasm',
    OPENCODE_TREE_SITTER_POWERSHELL_WASM_PATH: '/app/tree-sitter-powershell.wasm',
  }, capture: true });
  finished = true;
  await health;
  console.log(JSON.stringify({ checkpoint: 'OPENCODE_BUN_EXIT', workerErrors, ...result }, null, 2));
  process.exitCode = service && servicePassed && !serviceFailed && !workerErrors.length && result.code === 0 ? 0 : result.code || 1;
} finally {
  await Promise.all([...workers].map(w => w.terminate()));
  clearTimeout(deadline);
}
