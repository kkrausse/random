export const sourcePath = '/workspace/src/WelcomeCard.tsx';
export const maxBytes = 32 * 1024;
export const sha256 = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(x => x.toString(16).padStart(2, '0')).join('');
export function decodeSnapshot(stdout: string) {
  const lines = stdout.trim().split('\n');
  if (lines.length !== 4 || lines[0] !== 'HYBRID_SNAPSHOT_V1' || lines[1] !== lines[3] || !/^[a-f0-9]{64}$/.test(lines[1]))
    throw Error('Linux file changed while reading or invalid snapshot');
  const bytes = Uint8Array.from(atob(lines[2]), x => x.charCodeAt(0));
  if (bytes.length > maxBytes) throw Error('Snapshot exceeds 32 KiB limit');
  return { bytes, hash: lines[1] };
}
// One shell operation. A source edited during capture is rejected, never silently committed.
export const snapshotCommand = `set -e; test -f '${sourcePath}'; test ! -L '${sourcePath}'; test "$(wc -c < '${sourcePath}')" -le ${maxBytes}; printf 'HYBRID_SNAPSHOT_V1\\n'; sha256sum '${sourcePath}' | cut -d ' ' -f 1; base64 '${sourcePath}' | tr -d '\\n'; printf '\\n'; sha256sum '${sourcePath}' | cut -d ' ' -f 1`;
export async function commitSnapshot(fs: any, snapshot: ReturnType<typeof decodeSnapshot>, sequence: number) {
  if (await sha256(snapshot.bytes) !== snapshot.hash) throw Error('Linux snapshot hash mismatch');
  const stage = `/workspace/.hybrid-stage-${sequence}`;
  await fs.writeFile(stage, snapshot.bytes);
  try {
    if (await sha256(await fs.readFile(stage)) !== snapshot.hash) throw Error('Worker staging hash mismatch');
    await fs.rename(stage, sourcePath);
    const actual = await fs.readFile(sourcePath);
    if (await sha256(actual) !== snapshot.hash) throw Error('Worker committed bytes mismatch');
    return { sequence, path: sourcePath, sha256: snapshot.hash, bytes: actual.length };
  } finally { if (await fs.exists(stage)) await fs.rm(stage); }
}
