// Bounded investigation: mount published packages unchanged and exercise their APIs.
// Usage: node scripts/probe-tailwind-direct.mjs NODE_MODULES OUTPUT [WASM_ARTIFACT_ROOT]
// Optional artifact root contains unpacked lightningcss-wasm and oxide-wasm32-wasi
// directories. This selects official backends as dependency delivery, not source edits.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { runHeadlessProcessProbe } from './headless-process-probe.mjs';

const [modules, output, artifacts] = process.argv.slice(2).map(value => resolve(value));
assert.ok(modules && output, 'Expected NODE_MODULES OUTPUT [WASM_ARTIFACT_ROOT]');
const files = new Map();
const packages = new Map();
function tree(host, guest) {
  for (const entry of readdirSync(host, { withFileTypes: true })) {
    if (entry.name === '.bin') continue;
    const source = join(host, entry.name), destination = guest + '/' + entry.name;
    if (entry.isDirectory()) tree(source, destination);
    else if (entry.isFile() && !entry.name.endsWith('.node')) files.set(destination, readFileSync(source));
  }
}
function deliver(name, host) {
  if (packages.has(name)) return;
  if (artifacts && name === 'lightningcss') host = join(artifacts, 'lightningcss-wasm');
  const pkg = JSON.parse(readFileSync(join(host, 'package.json'), 'utf8'));
  packages.set(name, { name: pkg.name, version: pkg.version });
  tree(host, '/workspace/node_modules/' + name);
  const require = createRequire(join(host, 'package.json'));
  for (const dependency of Object.keys(pkg.dependencies ?? {})) {
    // Bundled dependencies already arrived with this unmodified package tree.
    if (existsSync(join(host, 'node_modules', dependency, 'package.json'))) continue;
    let folder = dirname(require.resolve(dependency));
    while (!existsSync(join(folder, 'package.json'))) {
      const parent = dirname(folder);
      assert.notEqual(parent, folder, `Cannot locate package ${dependency}`);
      folder = parent;
    }
    deliver(dependency, folder);
  }
}
deliver('@tailwindcss/vite', join(modules, '@tailwindcss/vite'));
if (artifacts) deliver('@tailwindcss/oxide-wasm32-wasi', join(artifacts, 'oxide-wasm32-wasi'));
const entry = `const assert = require('node:assert/strict');
const fs = require('node:fs');
console.log('TAILWIND_PROBE_START', process.platform, process.arch);
const { Scanner } = require('@tailwindcss/oxide');
const scanner = new Scanner({sources:[{base:'/workspace',pattern:'**/*',negated:false}]});
const candidates = scanner.scan();
assert.ok(candidates.includes('data-[state=open]:block'), JSON.stringify(candidates));
console.log('OXIDE_SCAN_PASS');
const lightning = require('lightningcss');
assert.ok(lightning.transform({filename:'a.css',code:Buffer.from('a { color: red; }'),minify:true}).code.length);
console.log('LIGHTNING_TRANSFORM_PASS');
const tw = require('@tailwindcss/node');
(async () => {
  const compiler = await tw.compile('@import "tailwindcss";', {base:'/workspace',onDependency() {}});
  const css = compiler.build(candidates);
  assert.ok(css.includes('[data-state="open"]'));
  assert.ok(css.includes('display: block'));
  console.log('TAILWIND_COMPILE_PASS');
  const plugin = await import('@tailwindcss/vite');
  const plugins = plugin.default();
  assert.ok(plugins.some(p => p.name.includes('tailwindcss')));
  console.log('TAILWIND_VITE_IMPORT_PASS');
})().catch(error => {console.error(error.stack);process.exitCode=1});
`;
const receipt = await runHeadlessProcessProbe({
  directory: output, name: artifacts ? 'tailwind-upstream-wasm' : 'tailwind-installed', timeoutMs: 30000,
  provenance: { packages: Object.fromEntries(packages), artifacts: artifacts ?? null },
  async exercise({ kernel, launch, closeStdin, waitForExit, text, stage }) {
    await kernel.writeFilesBatch([...files].map(([path, bytes]) => ({ path, bytes })));
    kernel.writeFile('/workspace/index.html', '<div class="data-[state=open]:block"></div>');
    kernel.writeFile('/workspace/probe.cjs', entry);
    stage('packages.mounted', { files: files.size });
    launch('node', ['/workspace/probe.cjs'], { cwd: '/workspace', env: { PATH: '/bin' } });
    closeStdin();
    await waitForExit();
    assert.ok(text('stdout').includes('TAILWIND_VITE_IMPORT_PASS'));
  },
});
console.log(JSON.stringify({ result: receipt.receipt.result, receiptPath: receipt.receiptPath,
  failure: receipt.receipt.primaryFailure }, null, 2));
for (const channel of ['stdout', 'stderr']) console.log(readFileSync(receipt.receipt.channels[channel].path, 'utf8'));
process.exitCode = receipt.receipt.result === 'PASS' ? 0 : 1;
