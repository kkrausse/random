import { test, expect, spyOn } from 'bun:test';
import { bundleFiles, readPreparedBundle } from '../src/prepared-bundle';
import { sha256 } from '../src/prepare-tree';
import type { PreparedEntry } from '../src/package-tree';

test('one compressed download restores binary and empty files, deduplicates content, and rejects corruption', async () => {
  const binary = new Uint8Array([0, 255, 128, 10]), empty = new Uint8Array();
  const entry = (destination: string, bytes: Uint8Array): PreparedEntry => ({ kind: 'file', destination,
    mode: 0o644, file: sha256(bytes) + '.bin', sha256: sha256(bytes), bytes: bytes.length });
  const entries = [entry('/a', binary), entry('/b', empty), entry('/c', binary)];
  expect(bundleFiles(entries)).toHaveLength(2);
  const compressed = Bun.gzipSync(binary), hash = sha256(compressed);
  const bundle = { file: hash + '.bundle.gz', sha256: hash, bytes: compressed.length };
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(compressed));
  try {
    const files = await readPreparedBundle(bundle, entries, '/prepared/', new AbortController().signal);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toBe('/prepared/' + bundle.file);
    expect(files.get(sha256(binary) + '.bin')).toEqual(binary);
    expect(files.get(sha256(empty) + '.bin')).toEqual(empty);
    await expect(readPreparedBundle(bundle, [entry('/a', empty)], '/', new AbortController().signal)).rejects.toThrow('size mismatch');
    fetch.mockImplementation(async () => new Response('corrupt'));
    await expect(readPreparedBundle(bundle, entries, '/', new AbortController().signal)).rejects.toThrow('integrity failure');
  } finally { fetch.mockRestore(); }
});
