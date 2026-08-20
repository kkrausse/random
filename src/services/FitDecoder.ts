import { Decoder, Profile, Stream } from '@garmin/fitsdk'
import { unzipSync } from 'fflate'

import type { ActivitySample, DecodedActivity } from '../domain/activity'

type FitMessage = Record<string, unknown>

const number = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const date = (value: unknown): Date | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

const coordinate = (value: unknown): number | null => {
  const parsed = number(value)
  if (parsed === null) return null
  return Math.abs(parsed) > 180 ? (parsed * 180) / 2 ** 31 : parsed
}

const fitBytes = (filename: string, bytes: Uint8Array): Uint8Array => {
  if (!filename.toLowerCase().endsWith('.zip')) return bytes
  const files = unzipSync(bytes)
  const fit = Object.entries(files).find(([name]) => name.toLowerCase().endsWith('.fit'))
  if (!fit) throw new Error(`${filename} does not contain a FIT file`)
  return fit[1]
}

export const decodeFitActivity = (
  filename: string,
  rawBytes: Uint8Array,
): DecodedActivity => {
  const bytes = fitBytes(filename, rawBytes)
  const stream = Stream.fromBuffer(Buffer.from(bytes))
  if (!Decoder.isFIT(stream)) throw new Error(`${filename} is not a FIT file`)

  const sessions: FitMessage[] = []
  const records: FitMessage[] = []
  const decoder = new Decoder(stream)
  const result = decoder.read({
    mesgListener: (messageNumber, message) => {
      const type = Profile.types.mesgNum[messageNumber]
      if (type === 'session') sessions.push(message as FitMessage)
      if (type === 'record') records.push(message as FitMessage)
    },
  })
  if (result.errors.length > 0) {
    throw new Error(`${filename}: ${result.errors.join('; ')}`)
  }

  const session = sessions[0]
  if (!session) throw new Error(`${filename} has no session message`)
  const startedAt = date(session.startTime) ?? date(records[0]?.timestamp)
  if (!startedAt) throw new Error(`${filename} has no start time`)

  const samples: ActivitySample[] = records.map((record) => ({
    timestamp: date(record.timestamp),
    lat: coordinate(record.positionLat),
    lon: coordinate(record.positionLong),
    distanceM: number(record.distance),
    altitudeM: number(record.enhancedAltitude) ?? number(record.altitude),
    speedMps: number(record.enhancedSpeed) ?? number(record.speed),
    heartRateBpm: number(record.heartRate),
    cadence: number(record.cadence),
    powerW: number(record.power),
  }))

  return {
    sport: typeof session.sport === 'string' ? session.sport : 'other',
    startedAt,
    durationSeconds: number(session.totalTimerTime) ?? number(session.totalElapsedTime),
    distanceM: number(session.totalDistance),
    ascentM: number(session.totalAscent),
    avgHrBpm: number(session.avgHeartRate),
    maxHrBpm: number(session.maxHeartRate),
    samples,
  }
}
