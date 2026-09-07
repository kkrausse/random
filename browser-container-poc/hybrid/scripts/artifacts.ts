import { readdir, mkdir, copyFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

const root = resolve(import.meta.dir, '..');
const source = resolve(root, '../vivari/.runtime/baseline/packages/core/dist');
const sha = (bytes: Uint8Array) => new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
const entries: { source: string; target: string; bytes: number; sha256: string }[] = [];
async function capture(dir: string, target: string) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'tsconfig.tsbuildinfo'].includes(item.name)) continue;
    if (item.isDirectory()) await capture(resolve(dir, item.name), `${target}/${item.name}`);
    else if (!item.name.endsWith('.map') && !(target.startsWith('vivari') && item.name.endsWith('.ts'))) {
      const path = resolve(dir, item.name), bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
      entries.push({ source: relative(root, path), target: `${target}/${item.name}`, bytes: bytes.length, sha256: sha(bytes) });
    }
  }
}
const lockFile = Bun.file(resolve(root, 'artifacts.lock.json'));
let lock: { entries: typeof entries; [key: string]: unknown };
if (await lockFile.exists()) lock = await lockFile.json();
else {
  await capture(source, 'vivari');
  await capture(resolve(root, '../qemu/public/qemu'), 'qemu');
  for (const [from, target] of [
    ['../qemu/src/runtime.ts', 'references/runtime.ts'], ['../qemu/src/runtime.css', 'references/runtime.css'],
    ['../qemu/public/serial-bridge.js', 'references/serial-bridge.js'],
    ['../qemu/guest/preview-bridge.ts', 'references/preview-bridge.ts'],
    ['../vivari/public/vendor/npm-pack.bin', 'vendor/npm-pack.bin'],
  ]) {
    const bytes = new Uint8Array(await Bun.file(resolve(root, from)).arrayBuffer());
    entries.push({ source: from, target, bytes: bytes.length, sha256: sha(bytes) });
  }
  await capture(resolve(root, '../qemu/guest/fixture'), 'fixture');
  lock = { created: new Date().toISOString(), vivariRevision: '2629c71097238400c45aefa213ef61df4794c2b7',
    buildReceipt: await Bun.file(resolve(root, '../vivari/.runtime/baseline-build.json')).json(), entries };
  await Bun.write(lockFile, JSON.stringify(lock, null, 2) + '\n');
}
for (const entry of lock.entries) {
  const dst = resolve(root, '.artifacts', entry.target);
  // Preserve the isolated runtime even if the concurrently owned source is rebuilt.
  const candidate = !entry.target.startsWith('qemu/') && await Bun.file(dst).exists() ? dst : resolve(root, entry.source);
  const bytes = new Uint8Array(await Bun.file(candidate).arrayBuffer());
  if (bytes.length !== entry.bytes || sha(bytes) !== entry.sha256) throw Error(`Pinned artifact mismatch: ${candidate}`);
  if (!entry.target.startsWith('qemu/') && candidate !== dst) {
    await mkdir(resolve(dst, '..'), { recursive: true });
    await copyFile(candidate, dst);
  }
}
console.log(`Verified ${lock.entries.length} artifacts; QEMU referenced in place, small runtime snapshotted.`);
