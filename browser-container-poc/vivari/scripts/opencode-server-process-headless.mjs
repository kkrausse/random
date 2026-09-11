// One unchanged retained artifact, using the live-output diagnostic harness.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { runtimeSourcePath } from './runtime-source.mjs';
import { runHeadlessProcessProbe } from './headless-process-probe.mjs';

if (!process.argv[2]) throw new Error('Usage: node scripts/opencode-server-process-headless.mjs <retained-build-root>');
const root = resolve(process.argv[2]);
const source = resolve(root, '.runtime/opencode-v2-source');
const output = resolve(root, '.runtime/opencode-bun-server');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
const provenance = { source, output, retainedBuildRoot: root,
  appRevision: '20aff6d9f643afe9abf8a048e68f019d049f5329',
  appTree: 'e4148bd22397254c48e64e11d60a158d7be9586f',
  lockSha256: '07711d25b2378d9a3491f6eb960b8386c7bd1831a15d401c04a3c77070cd2e75',
  runtimeRevision: '80d5cdd599fce4fa4817128461c865e009109d34',
  serverSha256: '55be88221d3d21dc373fb7ad7f80fdda3974a4a0be6453001e8e3df0957fc4fb',
  guest: 'bun /app/server.js', storage: 'fresh disk-backed SQLite snapshot adapter; not browser OPFS',
};
const result = await runHeadlessProcessProbe({
  directory: fileURLToPath(new URL('../.runtime/headless-diagnostics', import.meta.url)),
  name: 'opencode-server-process', provenance,
  exercise: async api => {
    const buildBytes = readFileSync(resolve(root, 'build-receipt.json'));
    assert.equal(hash(buildBytes), 'd6dcd8f0458d7bb3238229eebb0d01766eb4bd8861abc8e74646fe65fe8d7949');
    provenance.buildReceiptSha256 = hash(buildBytes);
    const build = JSON.parse(buildBytes);
    assert.equal(build.result, 'BUILD_PASS');
    assert.equal(build.buildAttempts, 1);
    assert.equal(build.exitCode, 0);
    assert.equal(build.source, source);
    assert.equal(git(source, 'rev-parse', 'HEAD'), provenance.appRevision);
    assert.equal(git(source, 'rev-parse', 'HEAD^{tree}'), provenance.appTree);
    assert.equal(git(source, 'status', '--short'), '');
    assert.equal(hash(readFileSync(resolve(source, 'bun.lock'))), provenance.lockSha256);
    assert.equal(git(runtimeSourcePath(), 'rev-parse', 'HEAD'), provenance.runtimeRevision);
    assert.equal(git(runtimeSourcePath(), 'status', '--short'), '');
    assert.equal(hash(readFileSync(resolve(output, 'server.js'))), provenance.serverSha256);
    assert.deepEqual(readdirSync(output).sort(), Object.keys(build.outputs).sort());
    for (const [file, expected] of Object.entries(build.recipe))
      assert.equal(hash(readFileSync(resolve(root, 'experiments/opencode-bun-server', file))), expected);
    for (const [file, expected] of Object.entries(build.outputs)) {
      const bytes = readFileSync(resolve(output, file));
      assert.equal(bytes.length, expected.bytes);
      assert.equal(hash(bytes), expected.sha256);
      await api.kernel.writeFilesBatch([{ path: '/app/' + file, bytes }]);
      api.stage('artifact.mounted', { file, ...expected });
    }
    api.stage('inputs.verified');
    api.kernel.mkdirp('/home/direct');
    const pid = api.launch('bun', ['/app/server.js'], { cwd: '/app', env: {
      PATH: '/bin', HOME: '/home/direct', OPENCODE_PASSWORD: 'isolated-probe-only',
      XDG_CONFIG_HOME: '/home/direct/config', XDG_STATE_HOME: '/home/direct/state',
      XDG_DATA_HOME: '/home/direct/data', XDG_CACHE_HOME: '/home/direct/cache',
      OPENCODE_TEST_HOME: '/home/direct', TMPDIR: '/home/direct/tmp',
      OPENCODE_TREE_SITTER_WASM_PATH: '/app/tree-sitter.wasm',
      OPENCODE_TREE_SITTER_BASH_WASM_PATH: '/app/tree-sitter-bash.wasm',
      OPENCODE_TREE_SITTER_POWERSHELL_WASM_PATH: '/app/tree-sitter-powershell.wasm',
    } });
    await api.waitForOutput('stdout', 'OPENCODE_SERVER_PROCESS_READY', 'background service boot failed');
    api.stage('application.ready');
    assert.equal(api.text('stderr'), '', 'Unexpected guest stderr; inspect retained stderr.bin');
    const unauthorized = await api.request(4096, { method: 'GET', url: '/api/health', body: '', headers: { host: '127.0.0.1:4096' } });
    assert.equal(unauthorized.status, 401);
    api.stage('authentication.rejected-missing-credential', { status: unauthorized.status });
    const health = await api.request(4096, { method: 'GET', url: '/api/health', body: '', headers: {
      host: '127.0.0.1:4096', authorization: 'Basic ' + Buffer.from('opencode:isolated-probe-only').toString('base64'),
    } });
    assert.equal(health.status, 200);
    assert.deepEqual(JSON.parse(health.body), { healthy: true, version: '0.0.0-beta-19425', pid });
    api.stage('health.authenticated', { status: health.status, ...JSON.parse(health.body) });
    api.closeStdin();
    await api.waitForOutput('stdout', 'OPENCODE_SERVER_PROCESS_SHUTDOWN_COMPLETE');
    api.stage('application.scope-closed');
    const exit = await api.waitForExit();
    assert.equal(exit.code, 0);
    assert.equal(exit.signal, null);
    assert.equal(exit.natural, true);
    assert.equal(api.text('stderr'), '', 'Unexpected guest stderr; inspect retained stderr.bin');
    // Raw artifacts and clean source/runtime remain part of acceptance after execution.
    for (const [file, expected] of Object.entries(build.outputs))
      assert.equal(hash(readFileSync(resolve(output, file))), expected.sha256);
    assert.equal(git(source, 'status', '--short'), '');
    assert.equal(git(runtimeSourcePath(), 'status', '--short'), '');
    api.stage('preservation.verified');
  },
});
console.log(JSON.stringify({ result: result.receipt.result, runID: result.receipt.runID,
  receiptPath: result.receiptPath, receiptSha256: result.receiptSha256,
  primaryFailure: result.receipt.primaryFailure, secondaryFailures: result.receipt.secondaryFailures,
  receiptWriteError: result.receiptWriteError, intendedReceiptPath: result.intendedReceiptPath,
  exit: result.receipt.exit, cleanup: result.receipt.cleanup, channels: result.receipt.channels,
  stages: result.receipt.stages }, null, 2));
process.exitCode = result.receipt.result === 'PASS' ? 0 : result.receipt.result === 'TIMEOUT' ? 124 : 1;
