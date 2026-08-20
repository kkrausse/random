import type { RoutePoint } from './activity'

export type RouteType = 'segment' | 'loop'

export interface DetectedRoute {
  readonly id: string
  readonly name: string
  readonly type: RouteType
  readonly sport: string
  readonly geometry: ReadonlyArray<RoutePoint>
  readonly distanceM: number
  readonly workoutCount: number
  readonly traversalCount: number
  readonly matchScore: number
  readonly popularityScore: number
  readonly overallScore: number
  readonly firstTraversalAt: string
  readonly lastTraversalAt: string
}

export interface RouteTraversal {
  readonly id: string
  readonly routeId: string
  readonly activityId: string
  readonly startedAt: string
  readonly endedAt: string
  readonly durationSec: number
  readonly distanceM: number
  readonly avgHeartRate: number | null
  readonly avgSpeed: number | null
  readonly matchErrorM: number
  readonly qualityScore: number
  readonly lapCount: number
  readonly lapTimesSec: ReadonlyArray<number>
}

export interface RouteDetail extends DetectedRoute {
  readonly traversals: ReadonlyArray<RouteTraversal>
}
