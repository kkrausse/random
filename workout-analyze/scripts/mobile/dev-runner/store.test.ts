import { describe, expect, test } from 'bun:test'
import { createRunnerStore, maxCodeBytes } from './store'

const native = (clientId = 'phone-1') => ({ clientId, kind: 'native' as const, label: 'Native iPhone shell', sourceUrl: 'http://100.86.29.19:4317/', build: 'dev' })
const simulator = { ...native('sim-1'), kind: 'simulator' as const, label: 'Simulator' }

describe('iPhone development runner queue', () => {
  test('targets a native phone by default and claims each job only once', () => {
    const store = createRunnerStore()
    const created = store.create({ code: 'return 1' })
    expect(store.claim(simulator)).toBeNull()
    expect(store.claim(native())).toEqual({ id: created.id, code: 'return 1', timeoutMs: 8_000 })
    expect(store.claim(native())).toBeNull()
    expect(store.complete(created.id, 'phone-1', { status: 'succeeded', value: 1, durationMs: 2 })).toBe(true)
    expect(store.complete(created.id, 'phone-1', { status: 'succeeded', value: 2, durationMs: 3 })).toBe(false)
  })

  test('honors explicit client targeting', () => {
    const store = createRunnerStore()
    store.create({ code: 'return 1', targetClientId: 'phone-2' })
    expect(store.claim(native('phone-1'))).toBeNull()
    expect(store.claim(native('phone-2'))?.id).toBeString()
  })

  test('marks interrupted work unknown without retrying mutations', () => {
    const store = createRunnerStore()
    const created = store.create({ code: 'await app.actions.pauseWorkout()' })
    store.claim(native())
    expect(store.abandon(created.id, 'phone-1')).toBe(true)
    expect(store.get(created.id)?.status).toBe('unknown')
    expect(store.claim(native())).toBeNull()
  })

  test('bounds code, timeout, and completed job retention', () => {
    let time = 1_000
    const store = createRunnerStore({ now: () => time, jobTtlMs: 100 })
    expect(() => store.create({ code: 'x'.repeat(maxCodeBytes + 1) })).toThrow()
    expect(() => store.create({ code: 'return 1', timeoutMs: 31_000 })).toThrow()
    const created = store.create({ code: 'return 1' })
    store.claim(native())
    store.complete(created.id, 'phone-1', { status: 'succeeded', durationMs: 1 })
    time += 101
    expect(store.get(created.id)).toBeNull()
  })

  test('expires an unclaimed job instead of retaining an infinite queue', () => {
    let time = 1_000
    const store = createRunnerStore({ now: () => time, jobTtlMs: 100 })
    const created = store.create({ code: 'return 1' })
    time += 101
    expect(store.get(created.id)).toBeNull()
  })
})
