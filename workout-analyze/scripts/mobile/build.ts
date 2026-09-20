import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'vite'
import { createMobileManifest } from './manifest'
import { composeMobileEngineArtifact, mobileEngineBuildId, type DiagnosticEngineVersion } from '../../src/engine/mobile-artifact'

const root = resolve(import.meta.dirname, '../..')
const dist = resolve(root, 'mobile/dist')
const engineFlagIndex = process.argv.indexOf('--engine')
const engineVersion: DiagnosticEngineVersion = process.argv.includes('--engine=v2') || (engineFlagIndex >= 0 && process.argv[engineFlagIndex + 1] === 'v2') ? 'v2' : 'v1'
const engineBuildId = mobileEngineBuildId(engineVersion)
const buildIdArgument = process.argv.find((argument) => argument.startsWith('--build-id='))?.slice('--build-id='.length)
const buildId = buildIdArgument ?? `phone-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${engineVersion}`

await rm(dist, { recursive: true, force: true })
await build({ configFile: resolve(root, 'mobile/vite.config.ts') })
await mkdir(resolve(dist, 'engine'), { recursive: true })
const [diagnosticSource, recordingSource] = await Promise.all([
  readFile(resolve(root, `src/engine/shell/tiny-engine-${engineVersion}.js`), 'utf8'),
  readFile(resolve(root, 'src/engine/recording/recording-engine-v1.js'), 'utf8'),
])
await writeFile(resolve(dist, 'engine/tiny-engine.js'), composeMobileEngineArtifact({ diagnosticVersion: engineVersion, diagnosticSource, recordingSource }))

const manifest = await createMobileManifest({ distDirectory: dist, buildId, engineBuildId })
await writeFile(resolve(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`Built ${buildId} with ${engineBuildId}: mobile/dist (${manifest.files.length} declared files)`)
