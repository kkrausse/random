import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createMobileManifest } from './manifest'
import { mobileBuildRoute, resolveBuildDeliveryFile } from './build-delivery'

let directory: string | null = null
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = null })

const createBuild = async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'mobile-build-delivery-'))
  await mkdir(resolve(directory, 'ui/assets'), { recursive: true })
  await mkdir(resolve(directory, 'engine'), { recursive: true })
  await writeFile(resolve(directory, 'ui/index.html'), '<script src="./assets/app.js"></script>')
  await writeFile(resolve(directory, 'ui/assets/app.js'), 'console.log("fixture")')
  await writeFile(resolve(directory, 'engine/tiny-engine.js'), 'globalThis.fixture = true')
  const manifest = await createMobileManifest({ distDirectory: directory, buildId: 'delivery-test-1', engineBuildId: 'phase1-engine-v1' })
  await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest))
  return directory
}

describe('mobile build delivery', () => {
  test('serves the manifest and only exactly declared artifacts', async () => {
    const root = await createBuild()
    const manifest = await resolveBuildDeliveryFile(root, `${mobileBuildRoute}/manifest.json`)
    const asset = await resolveBuildDeliveryFile(root, `${mobileBuildRoute}/ui/assets/app.js`)
    expect(manifest?.contentType).toContain('application/json')
    expect(asset).toMatchObject({ absolutePath: resolve(root, 'ui/assets/app.js'), sizeBytes: 22 })
    expect(await resolveBuildDeliveryFile(root, `${mobileBuildRoute}/undeclared.txt`)).toBeNull()
    expect(await resolveBuildDeliveryFile(root, `${mobileBuildRoute}/..%2Fsecret`)).toBeNull()
  })

  test('refuses an artifact changed after the manifest was generated', async () => {
    const root = await createBuild()
    await writeFile(resolve(root, 'ui/assets/app.js'), 'changed')
    await expect(resolveBuildDeliveryFile(root, `${mobileBuildRoute}/ui/assets/app.js`)).rejects.toThrow('does not match')
  })
})
