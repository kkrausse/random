import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import type { Plugin } from 'vite'

export const mobileBuildRoute = '/__workout/build'
export const maximumManifestBytes = 1024 * 1024
export const maximumBuildFileBytes = 32 * 1024 * 1024

interface ManifestFile {
  path: string
  sizeBytes: number
}

interface DeliveryManifest {
  files: ManifestFile[]
}

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
}

const safeRelativePath = (path: string) =>
  path.length > 0 && path.length <= 512 && !path.startsWith('/') && !path.includes('\\') &&
  path.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')

const loadManifest = async (distDirectory: string) => {
  const path = resolve(distDirectory, 'manifest.json')
  const metadata = await stat(path)
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > maximumManifestBytes) throw new Error('Build manifest is missing or oversized')
  const bytes = await readFile(path)
  const manifest = JSON.parse(bytes.toString('utf8')) as DeliveryManifest
  if (!Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > 1024) throw new Error('Build manifest has no bounded file list')
  const declared = new Map<string, number>()
  for (const file of manifest.files) {
    if (!file || typeof file.path !== 'string' || !safeRelativePath(file.path) || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1 || file.sizeBytes > maximumBuildFileBytes || declared.has(file.path)) {
      throw new Error('Build manifest contains an invalid file declaration')
    }
    declared.set(file.path, file.sizeBytes)
  }
  return { bytes, declared }
}

export interface BuildDeliveryFile {
  absolutePath: string
  bytes?: Buffer
  contentType: string
  sizeBytes: number
}

export const resolveBuildDeliveryFile = async (distDirectory: string, requestPath: string): Promise<BuildDeliveryFile | null> => {
  if (!requestPath.startsWith(`${mobileBuildRoute}/`)) return null
  let relativePath: string
  try { relativePath = decodeURIComponent(requestPath.slice(mobileBuildRoute.length + 1)) } catch { return null }
  if (!safeRelativePath(relativePath)) return null

  const { bytes, declared } = await loadManifest(distDirectory)
  if (relativePath === 'manifest.json') {
    return { absolutePath: resolve(distDirectory, relativePath), bytes, contentType: contentTypes['.json'], sizeBytes: bytes.length }
  }
  const declaredSize = declared.get(relativePath)
  if (declaredSize === undefined) return null
  const absolutePath = resolve(distDirectory, relativePath)
  const rootPrefix = `${resolve(distDirectory)}${sep}`
  if (!absolutePath.startsWith(rootPrefix)) return null
  const metadata = await stat(absolutePath)
  if (!metadata.isFile() || metadata.size !== declaredSize) throw new Error('Build artifact does not match its manifest size')
  return { absolutePath, contentType: contentTypes[extname(relativePath)] ?? 'application/octet-stream', sizeBytes: metadata.size }
}

const sendError = (response: ServerResponse, status: number, message: string) => {
  response.statusCode = status
  response.setHeader('Content-Type', 'text/plain; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(message)
}

export const mobileBuildDeliveryPlugin = ({ distDirectory }: { distDirectory: string }): Plugin => ({
  name: 'workout-mobile-build-delivery',
  apply: 'serve',
  configureServer(server) {
    server.config.logger.info(`[mobile build] GET ${mobileBuildRoute}/manifest.json from ${distDirectory}`)
    server.middlewares.use(async (request, response, next) => {
      const requestPath = request.url?.split('?', 1)[0] ?? ''
      if (!requestPath.startsWith(`${mobileBuildRoute}/`)) return next()
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.setHeader('Allow', 'GET, HEAD')
        return sendError(response, 405, 'Method not allowed')
      }
      try {
        const file = await resolveBuildDeliveryFile(distDirectory, requestPath)
        if (!file) return sendError(response, 404, 'Not found')
        response.statusCode = 200
        response.setHeader('Content-Type', file.contentType)
        response.setHeader('Content-Length', file.sizeBytes)
        response.setHeader('Cache-Control', 'no-store')
        if (request.method === 'HEAD') return response.end()
        if (file.bytes) return response.end(file.bytes)
        const stream = createReadStream(file.absolutePath)
        stream.on('error', () => { if (!response.writableEnded) sendError(response, 500, 'Unable to read build artifact') })
        stream.pipe(response)
      } catch (error) {
        server.config.logger.warn(`[mobile build] ${error instanceof Error ? error.message : 'delivery failure'}`)
        sendError(response, 503, 'Mobile build is unavailable; run bun run mobile:build')
      }
    })
  },
})
