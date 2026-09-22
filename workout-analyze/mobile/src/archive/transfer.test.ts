import { afterEach, describe, expect, test } from 'bun:test'
import type { BridgeClient } from '../bridge/client'
import { downloadPortableArchive, portableArchiveDownloadUrl } from './transfer'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

describe('Mac portable archive transport', () => {
  test('derives the endpoint from an editable source origin', () => {
    expect(portableArchiveDownloadUrl('https://mac.example.test:8443/some/ui/path')).toBe('https://mac.example.test:8443/__workout/portable-archive')
    expect(() => portableArchiveDownloadUrl('file:///private/archive')).toThrow()
  })

  test('uses the bounded native downloader and existing chunk reader', async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    const request = (async (method: string, params: unknown) => {
      calls.push({ method, params })
      if (method === 'file.downloadArchive') return { fileId: 'file-test', name: 'archive.zip', sizeBytes: 3 }
      if (method === 'file.read') return { dataBase64: 'AQID', offset: 0, nextOffset: 3, sizeBytes: 3, done: true }
      if (method === 'file.close') return { closed: true }
      throw new Error(`Unexpected ${method}`)
    }) as BridgeClient['request']

    const result = await downloadPortableArchive({ request }, true, 'https://mac.example.test:8443/')

    expect([...result.bytes]).toEqual([1, 2, 3])
    expect(calls.map((call) => call.method)).toEqual(['file.downloadArchive', 'file.read', 'file.close'])
    expect(calls[0]?.params).toEqual({ url: 'https://mac.example.test:8443/__workout/portable-archive' })
  })

  test('streams browser downloads with progress before shared import validation', async () => {
    globalThis.fetch = (async () => new Response(new Uint8Array([4, 5, 6]), { headers: { 'content-length': '3' } })) as unknown as typeof fetch
    const progress: Array<[number, number]> = []
    const result = await downloadPortableArchive({ request: (() => Promise.reject()) as BridgeClient['request'] }, false, 'http://localhost:4317', (read, total) => progress.push([read, total]))
    expect([...result.bytes]).toEqual([4, 5, 6])
    expect(progress.at(-1)).toEqual([3, 3])
  })
})
