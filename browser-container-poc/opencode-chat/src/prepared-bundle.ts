import type { PreparedEntry } from './package-tree';

export interface PreparedBundle { file: string; bytes: number; sha256: string }

/** Unique content, in manifest order; paths and metadata remain in the manifest. */
export function bundleFiles(entries: PreparedEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry): entry is Extract<PreparedEntry, { kind: 'file' }> => {
    if (entry.kind !== 'file' || seen.has(entry.file)) return false;
    seen.add(entry.file);
    return true;
  });
}

export async function readPreparedBundle(bundle: PreparedBundle, entries: PreparedEntry[], base: string, signal: AbortSignal) {
  if (!/^[a-f0-9]{64}$/.test(bundle.sha256) || bundle.file !== bundle.sha256 + '.bundle.gz'
    || !Number.isSafeInteger(bundle.bytes) || bundle.bytes < 0) throw Error('Invalid prepared bundle');
  const response = await fetch(base + bundle.file, { signal });
  if (!response.ok) throw Error(`Prepared bundle HTTP ${response.status}`);
  const compressed = new Uint8Array(await response.arrayBuffer());
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', compressed))].map(b => b.toString(16).padStart(2, '0')).join('');
  if (compressed.length !== bundle.bytes || hash !== bundle.sha256) throw Error('Prepared bundle integrity failure');
  const bytes = new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  let offset = 0;
  for (const entry of bundleFiles(entries)) {
    files.set(entry.file, bytes.subarray(offset, offset + entry.bytes));
    offset += entry.bytes;
  }
  if (offset !== bytes.length) throw Error('Prepared bundle size mismatch');
  return files;
}
