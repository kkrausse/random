// Mount the published package unchanged and execute its normal ESM API in workers.
// Host Node is only the worker supervisor; decompression and search run in the guest.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Worker, MessageChannel } from 'node:worker_threads';
import { integrationRoot, runtimeSourceUrl } from './runtime-source.mjs';

const pkg = resolve(integrationRoot, 'probes/ripgrep/node_modules/ripgrep');
assert.equal(JSON.parse(readFileSync(resolve(pkg, 'package.json'), 'utf8')).version, '0.3.1');
if (process.argv.includes('--native')) {
  const directory = mkdtempSync(resolve(tmpdir(), 'ripgrep-direct-'));
  try {
    mkdirSync(resolve(directory, 'node_modules'));
    mkdirSync(resolve(directory, 'cache'));
    symlinkSync(pkg, resolve(directory, 'node_modules/ripgrep'), 'dir');
    copyFileSync(resolve(integrationRoot, 'probes/runtime/ripgrep-direct.mjs'), resolve(directory, 'probe.mjs'));
    writeFileSync(resolve(directory, 'fixture.txt'), 'DIRECT_SEARCH_NEEDLE\n');
    for (const mode of ['cold', 'warm']) {
      const result = spawnSync(process.execPath, [resolve(directory, 'probe.mjs'), mode], {
        cwd: directory, env: { ...process.env, TMPDIR: resolve(directory, 'cache') }, encoding: 'utf8', timeout: 60_000,
      });
      console.log(JSON.stringify({ native: process.version, mode, status: result.status, stdout: result.stdout, stderr: result.stderr }));
      assert.equal(result.status, 0, result.stderr || String(result.error));
      assert.ok(result.stdout.includes(`RIPGREP_DIRECT_${mode.toUpperCase()}_PASS`));
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
  process.exit(0);
}
const { Kernel } = await import(runtimeSourceUrl('packages/kernel-host/kernel.js'));
const { createKernelFs } = await import(runtimeSourceUrl('packages/kernel-host/kernel-fs.js'));
const files = [];
function collect(directory, relative = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) collect(resolve(directory, entry.name), name);
    else {
      assert.ok(entry.isFile(), `Unexpected package entry: ${name}`);
      const bytes = readFileSync(resolve(directory, entry.name));
      files.push({ path: `/direct/node_modules/ripgrep/${name}`, bytes });
    }
  }
}
collect(pkg);
console.log(JSON.stringify({ package: 'ripgrep@0.3.1', transforms: [], inputs: files.map(file => ({
  path: file.path, bytes: file.bytes.length,
  sha256: createHash('sha256').update(file.bytes).digest('hex'),
})) }));
const workers = new Set();
const deadline = setTimeout(() => {
  console.error('RIPGREP_DIRECT_TIMEOUT');
  process.exit(1);
}, 60_000);
try {
  const fsWorker = new Worker(runtimeSourceUrl('scripts/fs-worker.mjs'));
  workers.add(fsWorker);
  let dispatch = () => {};
  await new Promise((resolve, reject) => {
    fsWorker.once('error', reject);
    fsWorker.on('message', message => message.type === 'ready' ? resolve() : dispatch(message));
  });
  const bridge = createKernelFs(fsWorker);
  dispatch = bridge.onMessage;
  const kernel = new Kernel({
    fs: bridge.fs,
    stdout: text => process.stdout.write(text),
    stderr: text => process.stderr.write(text),
    spawnWorker(info) {
      const worker = new Worker(runtimeSourceUrl('scripts/process-worker.mjs'));
      workers.add(worker);
      worker.on('message', message => info.on[message.type]?.(message));
      worker.on('error', error => { console.error(error); process.exitCode = 1; kernel.stop(info.pid); });
      const { port1, port2 } = new MessageChannel();
      fsWorker.postMessage({ type: 'fs-register', client: info.pid, sab: info.sab, port: port2 }, [port2]);
      worker.postMessage({ type: 'init', sab: info.sab, spec: info.spec, fsPort: port1 }, [port1]);
      return {
        postMessage: message => worker.postMessage(message),
        terminate() {
          void worker.terminate();
          fsWorker.postMessage({ type: 'fs-unregister', client: info.pid });
        },
      };
    },
  });
  kernel.installCoreutils();
  kernel.mkdirp('/tmp');
  await kernel.writeFilesBatch(files);
  kernel.writeFile('/direct/fixture.txt', 'DIRECT_SEARCH_NEEDLE\n');
  kernel.writeFile('/direct/probe.mjs', readFileSync(resolve(integrationRoot, 'probes/runtime/ripgrep-direct.mjs')));
  for (const mode of ['cold', 'warm']) {
    const result = await kernel.start('node', ['/direct/probe.mjs', mode], {
      cwd: '/direct', env: { PATH: '/bin', TMPDIR: '/tmp' }, capture: true,
    });
    console.log(JSON.stringify({ mode, ...result }));
    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes(`RIPGREP_DIRECT_${mode.toUpperCase()}_PASS`), 'Missing completion checkpoint');
  }
} finally {
  await Promise.all([...workers].map(worker => worker.terminate()));
  clearTimeout(deadline);
}
