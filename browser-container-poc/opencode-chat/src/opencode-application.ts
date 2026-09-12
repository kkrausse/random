import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

export interface ApplicationOutput { bytes: number; sha256: string }
export interface ApplicationContract {
  id: string;
  receiptSha256: string;
  sourceRevision: string;
  outputs: Record<string, ApplicationOutput>;
}

/** Qualification identity, not a general OpenCode release pin or a rebuild recipe. */
export const qualifiedOpenCodeCandidate = {
  id: 'opencode-server-process-beta-19425',
  receiptSha256: 'd6dcd8f0458d7bb3238229eebb0d01766eb4bd8861abc8e74646fe65fe8d7949',
  sourceRevision: '20aff6d9f643afe9abf8a048e68f019d049f5329',
  outputs: {
    'ffi-rs.darwin-arm64-xwnmxr1d.node': { bytes: 721896, sha256: '50158069dfc4fcef50af699b84f41b746eeeda076b43950c51828e1eb62f9bc7' },
    'server.js': { bytes: 28419496, sha256: '55be88221d3d21dc373fb7ad7f80fdda3974a4a0be6453001e8e3df0957fc4fb' },
    'tree-sitter-bash.wasm': { bytes: 1380769, sha256: '364f0a2cd385c792239423026ef442dbd073d34c396b7bc9e5932426b8e4aa5d' },
    'tree-sitter-powershell.wasm': { bytes: 983236, sha256: '1d30b5a21866354aa2eb94845556f1e19126ff00e3335048719a0e6435b1c154' },
    'tree-sitter.wasm': { bytes: 205488, sha256: 'f38dcc4b43b818f9a0785bc1c6d5611a75ac4cdd428ff3f02757c34ca4e46d7f' },
  },
} as const satisfies ApplicationContract;

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Generic supporting verifier. Trust comes from the caller's independent contract. */
export async function verifyApplicationDelivery(options: {
  receiptPath: string; outputDirectory: string; guestDirectory: string; contract: ApplicationContract;
}) {
  const { contract } = options;
  if (!/^\/(?:[\w.-]+\/)*[\w.-]+$/.test(options.guestDirectory)
    || options.guestDirectory.split('/').some(p => p === '.' || p === '..')) throw Error('Invalid application guest directory');
  const receiptBytes = await readFile(resolve(options.receiptPath));
  if (hash(receiptBytes) !== contract.receiptSha256) throw Error('Application receipt integrity failure');
  const receipt = JSON.parse(receiptBytes.toString('utf8'));
  if (receipt.result !== 'BUILD_PASS' || receipt.exitCode !== 0 || receipt.sourceStatus !== ''
    || receipt.sourceRevision !== contract.sourceRevision || !receipt.outputs
    || Object.keys(receipt.outputs).length !== Object.keys(contract.outputs).length) throw Error('Application receipt contract mismatch');
  const assets = await Promise.all(Object.entries(contract.outputs).map(async ([file, expected]) => {
    if (!/^[\w.-]+$/.test(file) || file === '.' || file === '..'
      || !Number.isSafeInteger(expected.bytes) || expected.bytes < 0 || !/^[a-f0-9]{64}$/.test(expected.sha256)) throw Error('Invalid application output contract');
    const recorded = receipt.outputs[file];
    if (recorded?.bytes !== expected.bytes || recorded?.sha256 !== expected.sha256) throw Error(`Application receipt output mismatch: ${file}`);
    const bytes = await readFile(join(resolve(options.outputDirectory), file));
    if (bytes.length !== expected.bytes || hash(bytes) !== expected.sha256) throw Error(`Application output integrity failure: ${file}`);
    // Return the verified bytes, avoiding a second host read between checking and packaging.
    return { file, destination: options.guestDirectory + '/' + file, bytes, sha256: expected.sha256, length: expected.bytes };
  }));
  return { provenance: { id: contract.id, receiptSha256: contract.receiptSha256, sourceRevision: contract.sourceRevision }, receiptBytes, assets };
}

/** Retained-root defaults; relocated archives may supply explicit receipt/output paths. */
export function readQualifiedOpenCodeApplication(root: string, paths: { receiptPath?: string; outputDirectory?: string } = {}) {
  return verifyApplicationDelivery({
    receiptPath: paths.receiptPath ?? join(root, 'build-receipt.json'),
    outputDirectory: paths.outputDirectory ?? join(root, '.runtime/opencode-bun-server'),
    guestDirectory: '/app', contract: qualifiedOpenCodeCandidate,
  });
}
