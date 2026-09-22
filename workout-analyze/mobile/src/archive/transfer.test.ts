import { afterEach, describe, expect, test } from 'bun:test'
import { downloadPortableArchive, portableArchiveDownloadUrl } from './transfer'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

describe('Mac portable archive transport', () => {
  test('derives the endpoint from an editable source origin', () => {
    expect(portableArchiveDownloadUrl('https://mac.example.test:8443/some/ui/path')).toBe('https://mac.example.test:8443/__workout/portable-archive')
    expect(() => portableArchiveDownloadUrl('file:///private/archive')).toThrow()
  })

  test('streams browser downloads with progress before shared import validation', async () => {
    globalThis.fetch = (async () => new Response(new Uint8Array([4, 5, 6]), { headers: { 'content-length': '3' } })) as unknown as typeof fetch
    const progress: Array<[number, number]> = []
    const result = await downloadPortableArchive('http://localhost:4317', (read, total) => progress.push([read, total]))
    expect([...result.bytes]).toEqual([4, 5, 6])
    expect(progress.at(-1)).toEqual([3, 3])
  })
})
