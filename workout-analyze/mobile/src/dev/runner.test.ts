import { describe, expect, test } from 'bun:test'
import { createCorrelationId } from './runner'

describe('development runner correlation id', () => {
  test('works when Web Crypto is absent on an HTTP WKWebView origin', () => {
    expect(createCorrelationId(null)).toMatch(/^phone-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/)
  })

  test('uses getRandomValues without requiring randomUUID', () => {
    const cryptoWithoutRandomUuid = { getRandomValues: (bytes: Uint8Array) => { bytes.fill(10); return bytes } }
    expect(createCorrelationId(cryptoWithoutRandomUuid)).toBe('phone-0a0a0a0a0a0a0a0a0a0a0a0a')
  })
})
