import { readdir, realpath, stat, mkdir, readFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { readRuntimeAssets } from '@kev-browser-agent-kit/workspace/assets';
import type { PreparedManifest } from './prepared';

export interface PrepareBrowserEditorOptions {
  appRoot: string;
  output: string;
  runtimeDirectory: string;
  openCodeDirectory: string;
  /** Explicit source delivery allowlist, relative to appRoot. Never includes server secrets. */
  source: string[];
}

/** Bun build-time preparation. Application source is unchanged; native bundlers use WASM. */
export async function prepareBrowserEditor(options: PrepareBrowserEditorOptions) {
  const root = resolve(options.appRoot), out = resolve(options.output);
  const runtime = await readRuntimeAssets(options.runtimeDirectory);
  const receipt = JSON.parse(await readFile(join(options.openCodeDirectory, 'receipt.json'), 'utf8'));
  if (receipt.revision !== 'd7a7256bb6b0952f486c95718cfbf460b1570a56') throw Error('Expected pinned OpenCode V2 package d7a7256');
  const pkg = await Bun.file(join(root, 'package.json')).json();
  const dependencies: Record<string, string> = {};
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    if (name.startsWith('@kev-browser-agent-kit/') || name.startsWith('@types/') || name === 'concurrently') continue;
    dependencies[name] = (await Bun.file(join(root, 'node_modules', name, 'package.json')).json()).version;
  }
  const install = join(out, 'dependencies');
  await mkdir(install, { recursive: true });
  await Bun.write(join(install, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies,
    overrides: { esbuild: 'npm:esbuild-wasm@0.25.12', rollup: 'npm:@rollup/wasm-node@4.63.1' } }));
  const process = Bun.spawn(['bun', 'install'], { cwd: install, stdout: 'inherit', stderr: 'inherit' });
  if (await process.exited) throw Error('Guest dependency installation failed');
  const assets: PreparedManifest['assets'] = [];
  const hash = (bytes: Uint8Array) => new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
  const prepared = join(out, 'prepared');
  async function add(destination: string, bytes: Uint8Array) {
    const sha256 = hash(bytes), file = sha256 + '.bin';
    await Bun.write(join(prepared, file), bytes);
    assets.push({ file, destination, sha256, bytes: bytes.length });
  }
  async function walk(directory: string, destination: string, visit: (path: string, destination: string) => Promise<void>) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['.bin', '.cache', '.git'].includes(entry.name)) continue;
      const path = await realpath(join(directory, entry.name));
      if ((await stat(path)).isDirectory()) await walk(path, destination + '/' + entry.name, visit);
      else await visit(path, destination + '/' + entry.name);
    }
  }
  await walk(join(install, 'node_modules'), '/workspace/node_modules', async (path, destination) => {
    // Host-native binaries cannot execute in the browser; their packages remain for resolution.
    if (/\.(node|exe)$/.test(path)) return;
    await add(destination, new Uint8Array(await Bun.file(path).arrayBuffer()));
  });
  // The shared Vite config imports this build-only entry. No editor/browser payload enters the guest.
  await add('/workspace/node_modules/@kev-browser-agent-kit/opencode-chat/package.json', new TextEncoder().encode(JSON.stringify({ type: 'module', exports: { './vite': './vite.js', './config': './config.js' } })));
  await add('/workspace/node_modules/@kev-browser-agent-kit/opencode-chat/vite.js', new Uint8Array(await Bun.file(join(import.meta.dirname, 'vite.js')).arrayBuffer()));
  await add('/workspace/node_modules/@kev-browser-agent-kit/opencode-chat/config.js', new Uint8Array(await Bun.file(join(import.meta.dirname, 'config.js')).arrayBuffer()));
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
  project['/package.json'] = JSON.stringify({ ...pkg, scripts: undefined, dependencies, devDependencies: undefined });
  const manifest: PreparedManifest = { format: 'browser-editor-v1', runtimeVersion: runtime.version, assets, project,
    preview: { entry: '/workspace/node_modules/vite/bin/vite.js', args: ['--configLoader', 'native', '--host', '0.0.0.0', '--port', '5173', '--strictPort'], cwd: '/workspace', env: { BROWSER_AGENT_GUEST: '1', NODE_ENV: 'development' } } };
  await Bun.write(join(prepared, 'manifest.json'), JSON.stringify(manifest));
  console.log(`Prepared shared application and ${assets.length} verified dependency/runtime files`);
  return manifest;
}
