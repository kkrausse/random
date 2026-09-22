import { describe, expect, test } from 'bun:test'

import { sha256 } from './sha256'

describe('portable SHA-256', () => {
  test('matches standard ASCII and Unicode vectors', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256('route 🚲')).toBe('219269dd0cf59f34c84850a25ce56095a12fc654d1e38e7146c66c0ec4bd4d5d')
  })
})
