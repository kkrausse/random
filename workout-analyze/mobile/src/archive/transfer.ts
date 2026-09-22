import type { BridgeClient } from '../bridge/client'
import { PORTABLE_ARCHIVE_MAX_COMPRESSED_BYTES } from '../../../src/engine/portable-archive'

const decodeBase64 = (value: string) => {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

const readNativeArchive = async (client: Pick<BridgeClient, 'request'>, selected: { fileId: string; name: string; sizeBytes: number }, onProgress?: (read: number, total: number) => void): Promise<{ name: string; bytes: Uint8Array }> => {
  const output = new Uint8Array(selected.sizeBytes)
  let offset = 0
  try {
    while (offset < selected.sizeBytes) {
      const page = await client.request('file.read', { fileId: selected.fileId, offset, length: Math.min(128 * 1024, selected.sizeBytes - offset) })
      if (page.offset !== offset || page.sizeBytes !== selected.sizeBytes || page.nextOffset <= offset) throw new Error('Native archive read cursor did not advance')
      const chunk = decodeBase64(page.dataBase64)
      if (chunk.length !== page.nextOffset - offset) throw new Error('Native archive chunk length was invalid')
      output.set(chunk, offset); offset = page.nextOffset; onProgress?.(offset, selected.sizeBytes)
    }
    return { name: selected.name, bytes: output }
  } finally {
    await client.request('file.close', { fileId: selected.fileId }).catch(() => undefined)
  }
}

export const pickNativeArchive = async (client: Pick<BridgeClient, 'request'>, onProgress?: (read: number, total: number) => void): Promise<{ name: string; bytes: Uint8Array }> =>
  readNativeArchive(client, await client.request('file.pickArchive', {}), onProgress)

export const portableArchiveDownloadUrl = (source: string) => {
  const base = new URL(source)
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('Mac URL must be an HTTP or HTTPS URL without credentials')
  return new URL('/__workout/portable-archive', base).href
}

const fetchWebArchive = async (url: string, onProgress?: (read: number, total: number) => void) => {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Mac archive download failed (${response.status})`)
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > PORTABLE_ARCHIVE_MAX_COMPRESSED_BYTES) throw new Error('Mac archive exceeds the 128 MiB import limit')
  const reader = response.body?.getReader()
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (!bytes.length || bytes.length > PORTABLE_ARCHIVE_MAX_COMPRESSED_BYTES) throw new Error('Mac archive is empty or exceeds the 128 MiB import limit')
    onProgress?.(bytes.length, declared || bytes.length)
    return bytes
  }
  const chunks: Uint8Array[] = []
  let completed = 0
  while (true) {
    const page = await reader.read()
    if (page.done) break
    completed += page.value.byteLength
    if (completed > PORTABLE_ARCHIVE_MAX_COMPRESSED_BYTES) { await reader.cancel(); throw new Error('Mac archive exceeds the 128 MiB import limit') }
    chunks.push(page.value); onProgress?.(completed, declared || completed)
  }
  if (!completed) throw new Error('Mac archive download was empty')
  const bytes = new Uint8Array(completed)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

export const downloadPortableArchive = async (client: Pick<BridgeClient, 'request'>, nativeDownload: boolean, source: string, onProgress?: (read: number, total: number) => void) => {
  const url = portableArchiveDownloadUrl(source)
  if (!nativeDownload) return { name: 'workout-analyze.workout-archive.zip', bytes: await fetchWebArchive(url, onProgress) }
  return readNativeArchive(client, await client.request('file.downloadArchive', { url }), onProgress)
}

export const downloadArchive = (bytes: Uint8Array, name: string) => {
  const blob = new Blob([bytes as BlobPart], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
