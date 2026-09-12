import { readdir, realpath, stat, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { readRuntimeAssets, readRuntimeBackendPolicy } from '@kev-browser-agent-kit/workspace/assets';
import type { PreparedManifest } from './prepared';
import { prepareDependencies } from './prepare-dependencies';
import { captureTree, sha256 as hash } from './prepare-tree';
import { validateTree, treeRoots } from './package-tree';

export interface PrepareBrowserEditorOptions {
  appRoot: string;
  output: string;
  runtimeDirectory: string;
  openCodeDirectory: string;
  /** Explicit source delivery allowlist, relative to appRoot. Never includes server secrets. */
  source: string[];
  /** Host Bun executable; defaults to the Bun running this preparer. */
  bunExecutable?: string;
}

/** Bun build-time preparation. Application source is unchanged; native bundlers use WASM. */
export async function prepareBrowserEditor(options: PrepareBrowserEditorOptions) {
  const root = resolve(options.appRoot), out = resolve(options.output);
  const runtime = await readRuntimeAssets(options.runtimeDirectory);
  const receipt = JSON.parse(await readFile(join(options.openCodeDirectory, 'receipt.json'), 'utf8'));
  if (receipt.revision !== 'd7a7256bb6b0952f486c95718cfbf460b1570a56') throw Error('Expected pinned OpenCode V2 package d7a7256');
  const policy = await readRuntimeBackendPolicy(options.runtimeDirectory);
  const dependencies = await prepareDependencies({ ...options, policy });
  try {
  const assets: PreparedManifest['assets'] = [];
  const prepared = join(out, 'prepared');
  async function add(destination: string, bytes: Uint8Array) {
    const sha256 = hash(bytes), file = sha256 + '.bin';
    await Bun.write(join(prepared, file), bytes);
    // Application receipt v1 has no modes; keep its existing non-executable JS
    // semantics until the independent application descriptor migration.
    const parents: string[] = [];
    for (let parent = destination.slice(0, destination.lastIndexOf('/')); treeRoots.some(root => parent === root || parent.startsWith(root + '/')); parent = parent.slice(0, parent.lastIndexOf('/'))) parents.unshift(parent);
    for (const destination of parents) if (!assets.some(entry => entry.destination === destination)) assets.push({ kind: 'directory', destination, mode: 0o755 });
    assets.push({ kind: 'file', mode: 0o644, file, destination, sha256, bytes: bytes.length });
  }
  async function walk(directory: string, destination: string, visit: (path: string, destination: string) => Promise<void>, ancestors = new Set<string>()) {
    const canonical = await realpath(directory);
    if (ancestors.has(canonical)) throw Error('Cyclic source directory link');
    const next = new Set(ancestors).add(canonical);
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['.git', 'node_modules'].includes(entry.name)) continue;
      const path = await realpath(join(directory, entry.name));
      if (!path.startsWith(root + '/')) throw Error('Source symlink escapes application');
      if ((await stat(path)).isDirectory()) await walk(path, destination + '/' + entry.name, visit, next);
      else await visit(path, destination + '/' + entry.name);
    }
  }
  assets.push(...await captureTree(join(dependencies.install, 'node_modules'), '/workspace/node_modules', async (file, bytes) => { await Bun.write(join(prepared, file), bytes); }));
  for (const asset of receipt.assets) {
    const bytes = new Uint8Array(await Bun.file(join(options.openCodeDirectory, asset.file)).arrayBuffer());
    if (bytes.length !== asset.bytes || hash(bytes) !== asset.sha256) throw Error(`OpenCode integrity failure: ${asset.file}`);
    await add(asset.destination, bytes);
  }
  await add('/opencode-v2/run.cjs', new TextEncoder().encode(`const child=require('child_process').spawn('bun',['/opencode-v2/cli/entry.cjs',...process.argv.slice(2)],{stdio:['pipe','inherit','inherit'],env:process.env});process.stdin.on('data',c=>child.stdin.write(c));process.stdin.once('end',()=>child.stdin.end());process.on('SIGINT',()=>child.kill('SIGINT'));child.on('error',e=>{console.error(e.message);process.exitCode=1});child.on('exit',code=>{process.stdin.pause();process.exitCode=code??1});`));
  const project: Record<string, string> = {};
  for (const name of options.source) {
    if (name.startsWith('/') || name.split('/').includes('..')) throw Error('Source must be app-relative');
    const path = join(root, name);
    const visit = async (file: string, destination: string) => { project[destination] = await Bun.file(file).text(); };
    if ((await stat(path)).isDirectory()) await walk(path, '/' + name, visit);
    else await visit(path, '/' + name);
  }
  project['/package.json'] = dependencies.provenance.original.manifest;
  project['/bun.lock'] = dependencies.provenance.original.lock;
  project['/.browser-editor/runtime-package.json'] = dependencies.provenance.derived.manifest;
  project['/.browser-editor/runtime-bun.lock'] = dependencies.provenance.derived.lock;
  validateTree(assets);
  const manifest: PreparedManifest = { format: 'browser-editor-v2', runtimeVersion: runtime.version, assets, project, dependencies: dependencies.provenance,
    preview: { entry: '/workspace/node_modules/vite/bin/vite.js', args: ['--configLoader', 'native', '--host', '0.0.0.0', '--port', '5173', '--strictPort'], cwd: '/workspace', env: { BROWSER_AGENT_GUEST: '1', NODE_ENV: 'development' } } };
  await Bun.write(join(prepared, 'manifest.json'), JSON.stringify(manifest));
  console.log(`Prepared shared application and ${assets.length} verified dependency/runtime tree entries`);
  return manifest;
  } finally { await dependencies.cleanup(); }
}
