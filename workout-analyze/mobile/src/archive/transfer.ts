import type { BridgeClient } from '../bridge/client'

const decodeBase64 = (value: string) => {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export const pickNativeArchive = async (client: Pick<BridgeClient, 'request'>, onProgress?: (read: number, total: number) => void): Promise<{ name: string; bytes: Uint8Array }> => {
  const selected = await client.request('file.pickArchive', {})
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

export const downloadArchive = (bytes: Uint8Array, name: string) => {
  const blob = new Blob([bytes as BlobPart], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
