import { Outlet, createFileRoute } from '@tanstack/react-router'

import { AppNav } from '../components/AppNav'

const routeTypes = new Set(['all', 'segment', 'loop'])

export const Route = createFileRoute('/analysis')({
  validateSearch: (search: Record<string, unknown>) => ({
    type: typeof search.type === 'string' && routeTypes.has(search.type) ? search.type as 'all' | 'segment' | 'loop' : 'all',
    sport: typeof search.sport === 'string' && search.sport ? search.sport : 'all',
    minimumWorkouts: typeof search.minimumWorkouts === 'number' && Number.isFinite(search.minimumWorkouts)
      ? Math.min(50, Math.max(2, Math.round(search.minimumWorkouts)))
      : 2,
  }),
  component: AnalysisLayout,
})

function AnalysisLayout() {
  return <main><AppNav /><Outlet /></main>
}
