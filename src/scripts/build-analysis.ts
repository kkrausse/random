import { Effect } from 'effect'

import { rebuildRouteAnalysis } from '../services/AnalysisDatabase'

const result = await Effect.runPromise(rebuildRouteAnalysis)
console.log(`Analyzed ${result.activities} activities: ${result.routes} routes, ${result.traversals} traversals`)
