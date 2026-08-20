import { createFileRoute } from '@tanstack/react-router'

import { AnalysisRouteList } from '../components/AnalysisRouteList'
import { getDetectedRoutes } from '../server/analysis.functions'

export const Route = createFileRoute('/analysis/')({ loader: () => getDetectedRoutes(), component: AnalysisIndex })

function AnalysisIndex() {
  const routes = Route.useLoaderData()
  return <><header className="analysis-header"><div><p className="eyebrow">Repeated path index</p><h1>Segment analysis</h1></div><p>Recurring roads, trails, and loops extracted from your workout history.</p></header><AnalysisRouteList routes={routes} /></>
}
