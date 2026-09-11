import { test, expect } from 'bun:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { validateBuildReceipt } from './opencode-bun-build-receipt'

test('receipt linkage rejects mismatches and missing receipts; absence stays observational', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opencode-receipt-test-'))
  try {
    const hash = createHash('sha256').update('fixture').digest('hex')
    const recipe = Object.fromEntries(['server.ts', 'build.ts', 'package.json'].map(file => [file, hash]))
    for (const file of Object.keys(recipe)) await writeFile(join(root, file), 'fixture')
    const source = { path: '/source', revision: 'd7a7256bb6b0952f486c95718cfbf460b1570a56', tree: 'f4999819e778ae35433716c72f643c1eaf1a30ba', status: '', lockSha256: hash, diffSha256: hash }
    const checkpoint = { ...source, head: source.revision }
    const observed = { output: '/output', source, assets: [{ file: 'server.js', bytes: 7, sha256: hash }],
      inputs: Object.keys(recipe).map(file => ({ file: 'experiments/opencode-bun-server/' + file, sha256: hash })) }
    const receipt = { result: 'BUILD_PASS', exitCode: 0, buildAttempts: 1, output: '/output', source: '/source',
      sourceBefore: checkpoint, sourceAfter: checkpoint, experiment: root, cwd: root, recipe,
      outputs: { 'server.js': { bytes: 7, sha256: hash } } }
    const path = join(root, 'receipt.json')
    await writeFile(path, JSON.stringify(receipt))
    expect(await validateBuildReceipt(undefined, observed)).toBeNull()
    expect((await validateBuildReceipt(path, observed))?.sha256).toHaveLength(64)
    await expect(validateBuildReceipt(join(root, 'missing.json'), observed)).rejects.toThrow()
    for (const assets of [[], [{ file: 'server.js', bytes: 8, sha256: hash }], [{ file: 'server.js', bytes: 7, sha256: 'bad' }]]) {
      await expect(validateBuildReceipt(path, { ...observed, assets })).rejects.toThrow('Build receipt mismatch')
    }
    await expect(validateBuildReceipt(path, { ...observed, source: { ...source, status: ' M file' } })).rejects.toThrow('clean source pin')
    await expect(validateBuildReceipt(path, { ...observed, output: '/other' })).rejects.toThrow('artifact/source paths')
    await writeFile(join(root, 'build.ts'), 'changed')
    await expect(validateBuildReceipt(path, observed)).rejects.toThrow('recipe build.ts')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
