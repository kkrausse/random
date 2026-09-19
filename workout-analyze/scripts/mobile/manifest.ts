import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { parseBuildManifest, type BuildManifest } from '../../src/shared/mobile'

const listFiles = async (root: string, directory = root): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? listFiles(root, path) : [relative(root, path).split(sep).join('/')]
  }))
  return nested.flat().sort()
}

export const createMobileManifest = async ({ distDirectory, buildId, engineBuildId, createdAt = new Date().toISOString() }: {
  distDirectory: string
  buildId: string
  engineBuildId: string
  createdAt?: string
}): Promise<BuildManifest> => {
  const paths = (await listFiles(distDirectory)).filter((path) => path !== 'manifest.json')
  const files = await Promise.all(paths.map(async (path) => {
    const absolute = resolve(distDirectory, path)
    const [bytes, metadata] = await Promise.all([readFile(absolute), stat(absolute)])
    return {
      path,
      role: path === 'ui/index.html' ? 'ui' as const : path === 'engine/tiny-engine.js' ? 'engine' as const : 'asset' as const,
      sizeBytes: metadata.size,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
  }))
  return parseBuildManifest({
    formatVersion: 1,
    buildId,
    createdAt,
    uiEntryPath: 'ui/index.html',
    engineEntryPath: 'engine/tiny-engine.js',
    engineBuildId,
    bridgeProtocol: { min: 1, max: 1 },
    engineApi: { min: 1, max: 1 },
    checkpointSchemaVersion: 1,
    requiredCapabilities: ['bridge.ping', 'session.snapshot'],
    files,
  })
}
