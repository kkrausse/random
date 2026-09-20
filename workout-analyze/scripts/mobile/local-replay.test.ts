import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { loadLocalReplayBundle } from './local-replay'

test('loads a synthetic local ZIP and rejects non-contiguous journals', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workout-replay-'))
  const file = join(directory, 'fixture.zip')
  const event = (journalSequence: number) => ({ formatVersion: 1, eventId: `event-${journalSequence}`, sessionId: 'ride-fixture', journalSequence, kind: 'future', sourceTimestamp: null, receivedAt: '2026-01-01T00:00:00.000Z', monotonicTimestampMs: null, provenance: { origin: 'liveNative', sourceId: null, monotonicClockId: null, lineage: null }, batch: null, payload: { encoding: 'json', value: {} } })
  const archive = (events: unknown[]) => zipSync({ 'manifest.json': strToU8(JSON.stringify({ sessionId: 'ride-fixture', startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z' })), 'journal-events.json': strToU8(JSON.stringify(events)) })
  try {
    writeFileSync(file, archive([event(1), event(2)]))
    expect(loadLocalReplayBundle(file).metadata.eventCount).toBe(2)
    writeFileSync(file, archive([event(1), event(3)]))
    expect(() => loadLocalReplayBundle(file)).toThrow('not contiguous')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
