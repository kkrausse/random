import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { DiagnosticLogStore, maxDiagnosticsBatchEvents, parseDiagnosticsUpload, redactDiagnosticEvent, type DiagnosticEvent } from './dev-logs'

let temporaryDirectory: string | null = null
afterEach(async () => { if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }); temporaryDirectory = null })

const event = (id: string): DiagnosticEvent => ({ id, timestamp: '2026-09-19T12:00:00Z', subsystem: 'synthetic-test', level: 'info', message: 'ready' })

describe('native development diagnostics', () => {
  test('parses the exact bounded upload contract', () => {
    expect(parseDiagnosticsUpload({ formatVersion: 1, uploadId: 'upload-1', events: [event('one')] }).events).toHaveLength(1)
    expect(() => parseDiagnosticsUpload({ formatVersion: 1, uploadId: 'upload-1', events: Array.from({ length: maxDiagnosticsBatchEvents + 1 }, (_, index) => event(`${index}`)) })).toThrow()
    expect(() => parseDiagnosticsUpload({ formatVersion: 1, uploadId: 'upload-1', events: [{ ...event('one'), unexpected: true }] })).toThrow()
    expect(() => parseDiagnosticsUpload({ formatVersion: 1, uploadId: 'upload-1', events: [{ ...event('one'), metadata: { nested: {} } }] })).toThrow()
  })

  test('redacts credential URLs and raw observations', () => {
    expect(redactDiagnosticEvent({ ...event('one'), message: 'GET https://user:pass@test.invalid/a?token=abc&safe=yes lat=42.1 hr:155', metadata: { authorization: 'Bearer secret', longitude: -71.2, note: 'https://test.invalid/?api_key=abc' } })).toEqual({
      ...event('one'),
      message: 'GET https://REDACTED:REDACTED@test.invalid/a?token=REDACTED&safe=yes lat=[REDACTED] hr=[REDACTED]',
      metadata: { authorization: '[REDACTED]', longitude: '[REDACTED]', note: 'https://test.invalid/?api_key=REDACTED' },
    })
  })

  test('deduplicates event ids and bounds the retrieval window', async () => {
    temporaryDirectory = await mkdtemp(resolve(tmpdir(), 'dev-logs-test-'))
    const printed: string[] = []
    const store = new DiagnosticLogStore({ directory: temporaryDirectory, print: (line) => printed.push(line) })
    await store.ingest([event('duplicate'), event('duplicate')])
    await store.ingest([event('duplicate'), ...Array.from({ length: 105 }, (_, index) => event(`event-${index}`))])
    expect(store.latest()).toHaveLength(100)
    expect(printed).toHaveLength(106)
    const lines = (await readFile(resolve(temporaryDirectory, 'native-diagnostics.jsonl'), 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(106)
  })
})
