import { describe, expect, test } from 'bun:test'

import { parseBuildManifest, parseCommand, parseNativeEvent, parseReply } from './validation'

const hash = 'a'.repeat(64)
const manifest = {
  formatVersion: 1,
  buildId: 'phone-2026.09.19',
  createdAt: '2026-09-19T12:00:00.000Z',
  uiEntryPath: 'ui/index.html',
  engineEntryPath: 'engine/tiny.js',
  engineBuildId: 'engine-1',
  bridgeProtocol: { min: 1, max: 1 },
  engineApi: { min: 1, max: 1 },
  checkpointSchemaVersion: 1,
  requiredCapabilities: ['bridge.ping'],
  files: [
    { path: 'ui/index.html', role: 'ui', sizeBytes: 12, sha256: hash },
    { path: 'engine/tiny.js', role: 'engine', sizeBytes: 24, sha256: hash },
  ],
}

describe('mobile wire validation', () => {
  test('accepts a closed, exact command', () => {
    expect(parseCommand({ protocolVersion: 1, requestId: 'req-1', method: 'bridge.ping', params: { nonce: 'hello' } })).toEqual({ protocolVersion: 1, requestId: 'req-1', method: 'bridge.ping', params: { nonce: 'hello' } })
  })

  test('rejects unknown methods, extra params, insecure downloads, and malformed events', () => {
    expect(() => parseCommand({ protocolVersion: 1, requestId: '1', method: 'workout.start', params: {} })).toThrow()
    expect(() => parseCommand({ protocolVersion: 1, requestId: '1', method: 'ui.reload', params: { surprise: true } })).toThrow()
    expect(() => parseCommand({ protocolVersion: 1, requestId: '1', method: 'appBuild.download', params: { manifestUrl: 'http://example.com/build.json' } })).toThrow()
    expect(() => parseNativeEvent({ protocolVersion: 1, sessionId: null, sequence: -1, type: 'session.updated', payload: {} })).toThrow()
  })

  test('validates method-specific native reply payloads', () => {
    expect(parseReply('ui.reload', { protocolVersion: 1, requestId: '1', ok: true, result: { accepted: true } }).ok).toBe(true)
    expect(() => parseReply('ui.reload', { protocolVersion: 1, requestId: '1', ok: true, result: { accepted: false } })).toThrow()
    expect(() => parseReply('permissions.status', { protocolVersion: 1, requestId: '1', ok: true, result: { promptsAutomatically: false } })).toThrow()
  })

  test('validates safe, bounded, complete manifests', () => {
    expect(parseBuildManifest(manifest).buildId).toBe('phone-2026.09.19')
    expect(() => parseBuildManifest({ ...manifest, files: [{ ...manifest.files[0], path: '../index.html' }, manifest.files[1]] })).toThrow()
    expect(() => parseBuildManifest({ ...manifest, files: [{ ...manifest.files[0], sizeBytes: 33 * 1024 * 1024 }, manifest.files[1]] })).toThrow()
    expect(() => parseBuildManifest({ ...manifest, engineEntryPath: 'missing.js' })).toThrow()
    expect(() => parseBuildManifest({ ...manifest, requiredCapabilities: ['workout.start'] })).toThrow()
  })
})
