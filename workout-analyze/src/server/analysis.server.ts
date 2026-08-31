import { Effect } from 'effect'

import { getAnalysisSettings, getDetectedRoute, listDetectedRoutes, rebuildRouteAnalysis } from '../services/AnalysisDatabase'
import type { DetectionConfig } from '../services/SegmentDetector'

export const getRoutesHandler = async () => {
  const [routes, settings] = await Promise.all([Effect.runPromise(listDetectedRoutes), Effect.runPromise(getAnalysisSettings)])
  return { routes, settings }
}
export const getRouteHandler = (id: string) => Effect.runPromise(getDetectedRoute(id))
export const rebuildAnalysisHandler = (config: DetectionConfig) => Effect.runPromise(rebuildRouteAnalysis(config))
