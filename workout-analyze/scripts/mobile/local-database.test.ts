import { describe, expect, test } from 'bun:test'
import { unzipSync, strFromU8 } from 'fflate'
import type { DatabaseHost } from '../../src/engine/database'
import { servePortableArchive } from './local-database'

describe('portable archive download endpoint', () => {
  test('exports the existing database through queries without schema or data mutation', async () => {
    const sql: string[] = []
    const database = {
      async query(statement: string) { sql.push(statement); return [] },
      async execute() { throw new Error('download endpoint attempted a mutation') },
      async bulkInsert() { throw new Error('download endpoint attempted a mutation') },
      async transaction() { throw new Error('download endpoint attempted a transaction') },
    } as unknown as DatabaseHost
    const headers = new Map<string, string>()
    let statusCode = 200
    let body: Uint8Array | string | undefined
    const request = { method: 'GET', headers: { origin: 'https://kevins-macbook-pro-2.tail7e28fb.ts.net:8443' } } as import('node:http').IncomingMessage
    const response = {
      setHeader(name: string, value: string | number) { headers.set(name.toLowerCase(), String(value)); return this },
      end(value?: Uint8Array | string) { body = value },
      get statusCode() { return statusCode }, set statusCode(value) { statusCode = value },
    } as unknown as import('node:http').ServerResponse

    await servePortableArchive(request, response, database)

    expect(statusCode).toBe(200)
    expect(headers.get('content-type')).toBe('application/zip')
    expect(headers.get('access-control-allow-origin')).toBe(request.headers.origin)
    expect(sql).toHaveLength(2)
    const manifest = JSON.parse(strFromU8(unzipSync(new Uint8Array(body as Uint8Array))['manifest.json']!))
    expect(manifest).toMatchObject({ format: 'workout-analyze-canonical-v1', workoutCount: 0, sampleCount: 0 })
  })
})
