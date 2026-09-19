import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { parseBuildManifest } from '../../src/shared/mobile'
import { createMobileManifest } from './manifest'

let temporaryDirectory: string | null = null
afterEach(async () => { if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }); temporaryDirectory = null })

describe('mobile build manifest', () => {
  test('declares entry files, assets, exact sizes, and hashes', async () => {
    temporaryDirectory = await mkdtemp(resolve(tmpdir(), 'mobile-manifest-'))
    await mkdir(resolve(temporaryDirectory, 'ui/assets'), { recursive: true })
    await mkdir(resolve(temporaryDirectory, 'engine'), { recursive: true })
    await writeFile(resolve(temporaryDirectory, 'ui/index.html'), '<script src="./assets/app.js"></script>')
    await writeFile(resolve(temporaryDirectory, 'ui/assets/app.js'), 'console.log("fixture")')
    await writeFile(resolve(temporaryDirectory, 'engine/tiny-engine.js'), 'globalThis.fixture = true')

    const manifest = await createMobileManifest({ distDirectory: temporaryDirectory, buildId: 'test-build-1', engineBuildId: 'phase1-engine-v1', createdAt: '2026-09-19T12:00:00Z' })
    expect(parseBuildManifest(manifest)).toEqual(manifest)
    expect(manifest.files.map((file) => [file.path, file.role])).toEqual([
      ['engine/tiny-engine.js', 'engine'], ['ui/assets/app.js', 'asset'], ['ui/index.html', 'ui'],
    ])
    expect(manifest.files.every((file) => file.sizeBytes > 0 && /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true)
  })
})
