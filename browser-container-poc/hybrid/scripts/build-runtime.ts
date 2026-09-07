import { resolve } from 'node:path';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { patchWait } from './syscall-wait';

const root = resolve(import.meta.dir, '..');
const upstream = resolve(root, '../vivari/.runtime/baseline');
const expectedRevision = '2629c71097238400c45aefa213ef61df4794c2b7';
const revision = await Bun.$`git -C ${upstream} rev-parse HEAD`.text();
if (revision.trim() !== expectedRevision) throw Error('Unexpected upstream source revision');
await Bun.$`git -C ${upstream} diff --quiet HEAD`;
const { build } = await import(resolve(upstream, 'node_modules/vite/dist/node/index.js'));
const outDir = resolve(root, '.artifacts/fixed-runtime');
const changed = ['packages/runtime/fs-client.js', 'packages/kernel-host/kernel-fs.js'];
const sources = new Map<string, string>();
const sha = (text: string | Uint8Array) => new Bun.CryptoHasher('sha256').update(text).digest('hex');
const previousFile = Bun.file(resolve(root, 'runtime-build.json'));
const previous = await previousFile.exists() ? await previousFile.json() : undefined;
const inputs = [];
for (const path of changed) {
  const text = await readFile(resolve(upstream, path), 'utf8');
  const expected = previous?.inputs.find((input: any) => input.path === path);
  if (expected && expected.originalSha256 !== sha(text)) throw Error(`Source pin mismatch: ${path}`);
  sources.set(resolve(upstream, path), patchWait(text));
  inputs.push({ path, originalSha256: sha(text), patchedSha256: sha(patchWait(text)) });
}
const wasmInputs = [];
for (const crate of ['vfs', 'codec', 'crypto']) {
  for await (const path of new Bun.Glob(`packages/${crate}/pkg/*.{js,wasm}`).scan({ cwd: upstream })) {
    const bytes = new Uint8Array(await Bun.file(resolve(upstream, path)).arrayBuffer());
    const expected = previous?.wasmInputs?.find((input: any) => input.path === path);
    if (expected && expected.sha256 !== sha(bytes)) throw Error(`Wasm input pin mismatch: ${path}`);
    wasmInputs.push({ path, bytes: bytes.length, sha256: sha(bytes) });
  }
}
const overlay = () => ({ name: 'hybrid-late-notify-source-overlay', enforce: 'pre',
  load(id: string) { return sources.get(id); } });
await build({ configFile: false, root: resolve(upstream, 'packages/core'), plugins: [overlay()],
  build: { target: 'es2022', outDir, emptyOutDir: true, minify: false,
    lib: { entry: resolve(upstream, 'packages/core/src/index.ts'), formats: ['es'], fileName: () => 'index.js' },
    rollupOptions: { output: { assetFileNames: 'assets/[name]-[hash][extname]', chunkFileNames: 'assets/[name]-[hash].js' } } },
  worker: { format: 'es', plugins: () => [overlay()] } });
await mkdir(resolve(outDir, 'assets'), { recursive: true });
await copyFile(resolve(upstream, 'packages/studio/public/sw.js'), resolve(outDir, 'assets/sw.js'));
await copyFile(resolve(upstream, 'LICENSE'), resolve(outDir, 'assets/LICENSE.vivari.txt'));
const baseline = await Bun.file(resolve(root, 'artifacts.lock.json')).json();
const files = [];
for await (const name of new Bun.Glob('**/*').scan({ cwd: outDir, onlyFiles: true })) {
  const bytes = new Uint8Array(await Bun.file(resolve(outDir, name)).arrayBuffer());
  files.push({ name, bytes: bytes.length, sha256: sha(bytes) });
}
await writeFile(resolve(root, 'runtime-build.json'), JSON.stringify({ revision: baseline.vivariRevision,
  base: '../vivari/.runtime/baseline', fix: 'Recheck syscall state after late/spurious notification',
  bun: Bun.version, vite: (await Bun.file(resolve(upstream, 'node_modules/vite/package.json')).json()).version,
  upstreamLockSha256: sha(new Uint8Array(await Bun.file(resolve(upstream, 'bun.lock')).arrayBuffer())), inputs, wasmInputs, files }, null, 2) + '\n');
console.log('Built isolated hybrid runtime; sibling runtime unchanged.');
