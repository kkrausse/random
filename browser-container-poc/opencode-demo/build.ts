import { cp, mkdir, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const root = import.meta.dirname;
const source = resolve(root, '../vivari');
const out = join(root, '.snapshot');
await mkdir(out, { recursive: true });
const hash = (b: Uint8Array) => new Bun.CryptoHasher('sha256').update(b).digest('hex');
await cp(join(source, '.runtime/patched/packages/core/dist'), join(out, 'runtime'), { recursive: true });
for (const name of await readdir(join(out, 'runtime'), { recursive: true })) {
  const f = Bun.file(join(out, 'runtime', name));
  if (await f.exists() && hash(new Uint8Array(await f.arrayBuffer())) !== hash(new Uint8Array(await Bun.file(join(source, '.runtime/patched/packages/core/dist', name)).arrayBuffer()))) throw Error('Runtime changed during snapshot; wait for its build to finish and retry');
}
const receipt = await Bun.file(join(source, '.runtime/opencode-tui-package/receipt.json')).json();
const assets = [];
for (const a of receipt.assets.filter((a: any) => a.mode === 'cli')) {
  const bytes = new Uint8Array(await Bun.file(join(source, '.runtime/opencode-tui-package', a.file)).arrayBuffer());
  if (hash(bytes) !== a.sha256) throw Error(`Source changing: ${a.file}; retry after packaging finishes`);
  await Bun.write(join(out, 'guest', a.file), bytes);
  assets.push(a);
}
for (const [file, destination] of [
  ['.runtime/opentui-source/packages/core/src/zig/zig-out/bin/opentui.wasm', '/ffi-probe/opentui.wasm'],
  ['.runtime/opentui.ffi.json', '/ffi-probe/opentui.ffi.json'],
]) {
  const bytes = new Uint8Array(await Bun.file(join(source, file)).arrayBuffer());
  const name = destination.split('/').pop()!;
  await Bun.write(join(out, 'guest', name), bytes);
  assets.push({ file: name, destination, bytes: bytes.length, sha256: hash(bytes) });
}
const fixture: Record<string, string> = {};
for (const name of await readdir(join(source, 'fixture'), { recursive: true })) {
  const f = Bun.file(join(source, 'fixture', name));
  if (await f.exists()) fixture[name] = await f.text();
}
await Bun.write(join(out, 'fixture.json'), JSON.stringify(fixture));
await Bun.write(join(out, 'manifest.json'), JSON.stringify({ revision: receipt.revision, assets }, null, 2));
const result = await Bun.build({ entrypoints: [join(root, 'main.ts')], outdir: out, target: 'browser', plugins: [{ name: 'runtime', setup(b) { b.onResolve({ filter: /^@vivari\/core$/ }, () => ({ path: join(out, 'runtime/index.js') })); } }] });
if (!result.success) throw Error(result.logs.join('\n'));
await cp(join(source, 'node_modules/@xterm/xterm/css/xterm.css'), join(out, 'xterm.css'));
const hashes: Record<string, string> = {};
for (const name of await readdir(out, { recursive: true })) {
  if (name === 'hashes.json') continue;
  const f = Bun.file(join(out, name));
  if (await f.exists()) hashes[name] = hash(new Uint8Array(await f.arrayBuffer()));
}
await Bun.write(join(out, 'hashes.json'), JSON.stringify(hashes, null, 2));
console.log(`Snapshot ready: ${assets.length} guest assets; OpenCode ${receipt.revision}`);
