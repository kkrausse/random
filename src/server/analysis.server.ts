import { Effect } from 'effect'

import { getDetectedRoute, listDetectedRoutes } from '../services/AnalysisDatabase'

export const getRoutesHandler = () => Effect.runPromise(listDetectedRoutes)
export const getRouteHandler = (id: string) => Effect.runPromise(getDetectedRoute(id))
