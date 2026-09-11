import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
type Observation = {
  output: string
  source: { path: string; revision: string; tree: string; status: string; lockSha256: string; diffSha256: string }
  assets: { file: string; bytes: number; sha256: string }[]
  inputs: { file: string; sha256: string | null }[]
}

// Validate this experiment's retained clean-build receipt, not a general attestation format.
export async function validateBuildReceipt(path: string | undefined, observed: Observation) {
  if (path === undefined) return null
  const bytes = await readFile(path)
  const receipt = JSON.parse(bytes.toString())
  const requireMatch = (ok: boolean, field: string) => {
    if (!ok) throw Error('Build receipt mismatch: ' + field)
  }
  requireMatch(receipt?.result === 'BUILD_PASS' && receipt.exitCode === 0 && receipt.buildAttempts === 1, 'build result')
  requireMatch(receipt.output === observed.output && receipt.source === observed.source.path, 'artifact/source paths')
  requireMatch(observed.source.revision === 'd7a7256bb6b0952f486c95718cfbf460b1570a56' &&
    observed.source.tree === 'f4999819e778ae35433716c72f643c1eaf1a30ba' && observed.source.status === '', 'clean source pin')
  for (const checkpoint of ['sourceBefore', 'sourceAfter']) {
    const recorded = receipt[checkpoint]
    requireMatch(recorded?.head === observed.source.revision && recorded.tree === observed.source.tree &&
      recorded.status === observed.source.status && recorded.lockSha256 === observed.source.lockSha256 &&
      recorded.diffSha256 === observed.source.diffSha256, checkpoint)
  }
  requireMatch(receipt.outputs && Object.keys(receipt.outputs).length === observed.assets.length, 'output set')
  for (const asset of observed.assets) {
    const recorded = receipt.outputs[asset.file]
    requireMatch(recorded?.bytes === asset.bytes && recorded.sha256 === asset.sha256, 'output ' + asset.file)
  }
  requireMatch(typeof receipt.experiment === 'string' && receipt.cwd === receipt.experiment, 'recipe directory')
  requireMatch(receipt.recipe && Object.keys(receipt.recipe).sort().join(',') === 'build.ts,package.json,server.ts', 'recipe set')
  for (const file of ['server.ts', 'build.ts', 'package.json']) {
    const hash = sha256(await readFile(resolve(receipt.experiment, file)))
    requireMatch(hash === receipt.recipe[file] &&
      observed.inputs.find(input => input.file === 'experiments/opencode-bun-server/' + file)?.sha256 === hash, 'recipe ' + file)
  }
  return {
    path: resolve(path), bytes: bytes.length, sha256: sha256(bytes),
    validation: 'Matched emitted file set, bytes and hashes; clean pinned source before/after; copied and current recipe hashes. Dependency audit and builder details are recorded build-time claims, not re-audited at serve time.',
    receipt,
  }
}
