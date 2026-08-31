import { createServerFn } from '@tanstack/react-start'

import type { DetectionConfig } from '../services/SegmentDetector'

export const getDetectedRoutes = createServerFn({ method: 'GET' }).handler(async () => {
  const { getRoutesHandler } = await import('./analysis.server')
  return getRoutesHandler()
})

export const getDetectedRoute = createServerFn({ method: 'GET' })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const { getRouteHandler } = await import('./analysis.server')
    return getRouteHandler(data.id)
  })

export const rebuildAnalysis = createServerFn({ method: 'POST' })
  .validator((input: DetectionConfig) => input)
  .handler(async ({ data }) => {
    const { rebuildAnalysisHandler } = await import('./analysis.server')
    return rebuildAnalysisHandler(data)
  })
