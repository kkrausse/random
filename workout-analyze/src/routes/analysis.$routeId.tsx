import { createFileRoute, notFound } from '@tanstack/react-router'

import { RouteDetail } from '../components/RouteDetail'
import { getDetectedRoute } from '../server/analysis.functions'

export const Route = createFileRoute('/analysis/$routeId')({
  validateSearch: (search: Record<string, unknown>) => ({
    minimumQuality: typeof search.minimumQuality === 'number' && Number.isFinite(search.minimumQuality)
      ? Math.min(100, Math.max(50, Math.round(search.minimumQuality)))
      : 65,
    windowLength: search.windowLength === 3 || search.windowLength === 5 || search.windowLength === 10 ? search.windowLength : 1 as 1 | 3 | 5 | 10,
    mode: search.mode === 'best' || search.mode === 'all' ? search.mode : 'representative' as 'representative' | 'best' | 'all',
  }),
  loader: async ({ params }) => {
    const route = await getDetectedRoute({ data: { id: params.routeId } })
    if (!route) throw notFound()
    return route
  },
  component: DetailPage,
})

function DetailPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return <RouteDetail route={Route.useLoaderData()} controls={search} onControlsChange={(controls) => navigate({ search: (current) => ({ ...current, ...controls }) })} />
}
