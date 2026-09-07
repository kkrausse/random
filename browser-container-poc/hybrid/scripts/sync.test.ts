import { expect, test } from 'bun:test';
import { decodeSnapshot, commitSnapshot, sha256, sourcePath } from '../src/sync';
test('capture rejects unstable reads; verified bytes replace destination in one rename', async () => {
  const bytes = new TextEncoder().encode('Unicode λ\n'), hash = await sha256(bytes);
  const snap = decodeSnapshot(`HYBRID_SNAPSHOT_V1\n${hash}\n${Buffer.from(bytes).toString('base64')}\n${hash}\n`);
  expect(() => decodeSnapshot(`HYBRID_SNAPSHOT_V1\n${hash}\nYQ==\n${'0'.repeat(64)}`)).toThrow();
  const data = new Map([[sourcePath, new TextEncoder().encode('old')]]);
  let renames = 0;
  const fs = { async writeFile(p: string, b: Uint8Array) { data.set(p, b); }, async readFile(p: string) { return data.get(p)!; },
    async rename(a: string, b: string) { expect(new TextDecoder().decode(data.get(b))).toBe('old'); renames++; data.set(b, data.get(a)!); data.delete(a); },
    async exists(p: string) { return data.has(p); }, async rm(p: string) { data.delete(p); } };
  await expect(commitSnapshot(fs, { ...snap, hash: '0'.repeat(64) }, 1)).rejects.toThrow('hash mismatch');
  expect(new TextDecoder().decode(data.get(sourcePath))).toBe('old');
  expect((await commitSnapshot(fs, snap, 2)).sha256).toBe(hash);
  expect(renames).toBe(1); expect(data.size).toBe(1);
});
