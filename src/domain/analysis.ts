import type { RoutePoint } from './activity'

export type RouteType = 'segment' | 'loop'

export interface RouteSupportPoint {
  readonly distanceM: number
  readonly workoutCount: number
}

export interface DetectedRoute {
  readonly id: string
  readonly name: string
  readonly type: RouteType
  readonly sport: string
  readonly geometry: ReadonlyArray<RoutePoint>
  readonly supportProfile: ReadonlyArray<RouteSupportPoint>
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
  readonly activityRoute: ReadonlyArray<RoutePoint>
}

export interface RouteCoverage {
  readonly id: string
  readonly routeId: string
  readonly activityId: string
  readonly startedAt: string
  readonly endedAt: string
  readonly startDistanceM: number
  readonly endDistanceM: number
  readonly qualityScore: number
}

export interface RouteDetail extends DetectedRoute {
  readonly traversals: ReadonlyArray<RouteTraversal>
  readonly coverages: ReadonlyArray<RouteCoverage>
}

export interface WorkoutRouteMatch {
  readonly traversalId: string
  readonly routeId: string
  readonly routeName: string
  readonly routeType: RouteType
  readonly routeSport: string
  readonly routeDistanceM: number
  readonly routeWorkoutCount: number
  readonly routeTraversalCount: number
  readonly routeMatchScore: number
  readonly geometry: ReadonlyArray<RoutePoint>
  readonly startedAt: string
  readonly endedAt: string
  readonly durationSec: number
  readonly distanceM: number
  readonly avgHeartRate: number | null
  readonly avgSpeed: number | null
  readonly qualityScore: number
  readonly lapCount: number
}
