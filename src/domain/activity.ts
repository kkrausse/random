import { Schema } from 'effect'

export const RoutePoint = Schema.Struct({
  lat: Schema.Number,
  lon: Schema.Number,
})

export const Activity = Schema.Struct({
  id: Schema.String,
  sourceActivityId: Schema.String,
  sport: Schema.String,
  startedAt: Schema.String,
  durationSeconds: Schema.NullOr(Schema.Number),
  distanceM: Schema.NullOr(Schema.Number),
  ascentM: Schema.NullOr(Schema.Number),
  avgHrBpm: Schema.NullOr(Schema.Number),
  maxHrBpm: Schema.NullOr(Schema.Number),
  route: Schema.Array(RoutePoint),
})

export type Activity = typeof Activity.Type
export type RoutePoint = typeof RoutePoint.Type

export interface ActivitySample {
  readonly timestamp: Date | null
  readonly lat: number | null
  readonly lon: number | null
  readonly distanceM: number | null
  readonly altitudeM: number | null
  readonly speedMps: number | null
  readonly heartRateBpm: number | null
  readonly cadence: number | null
  readonly powerW: number | null
}

export interface DecodedActivity {
  readonly sport: string
  readonly startedAt: Date
  readonly durationSeconds: number | null
  readonly distanceM: number | null
  readonly ascentM: number | null
  readonly avgHrBpm: number | null
  readonly maxHrBpm: number | null
  readonly samples: ReadonlyArray<ActivitySample>
}
