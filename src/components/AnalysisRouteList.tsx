import { Link } from '@tanstack/react-router'
import { Flag, RefreshCw, Repeat2, Route as RouteIcon } from 'lucide-react'
import { useDeferredValue } from 'react'

import type { DetectedRoute, RouteType } from '../domain/analysis'
import { RouteThumbnail } from './RouteThumbnail'

const distance = (meters: number) => meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`

type RouteFilters = { type: 'all' | RouteType; sport: string; minimumWorkouts: number }

export function AnalysisRouteList({ routes, filters, onFiltersChange }: {
  routes: ReadonlyArray<DetectedRoute>
  filters: RouteFilters
  onFiltersChange: (filters: Partial<RouteFilters>) => void
}) {
  const deferredMinimum = useDeferredValue(filters.minimumWorkouts)
  const sports = [...new Set(routes.map((route) => route.sport))].sort()
  const visible = routes.filter((route) =>
    (filters.type === 'all' || route.type === filters.type)
    && (filters.sport === 'all' || route.sport === filters.sport)
    && route.workoutCount >= deferredMinimum)

  if (routes.length === 0) {
    return (
      <section className="analysis-empty">
        <RefreshCw aria-hidden="true" />
        <h2>No derived routes yet</h2>
        <p>Rebuild the local index to run route detection over your GPS history.</p>
        <code>bun run build:analysis</code>
      </section>
    )
  }

  return (
    <>
      <section className="analysis-filters" aria-label="Route filters">
        <label>Type<select value={filters.type} onChange={(event) => onFiltersChange({ type: event.target.value as RouteFilters['type'] })}><option value="all">All routes</option><option value="segment">Segments</option><option value="loop">Loops</option></select></label>
        <label>Sport<select value={filters.sport} onChange={(event) => onFiltersChange({ sport: event.target.value })}><option value="all">All sports</option>{sports.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>Minimum workouts<input type="number" min="2" max="50" value={filters.minimumWorkouts} onChange={(event) => onFiltersChange({ minimumWorkouts: Number(event.target.value) })} /></label>
        <span className="filter-result">{visible.length} of {routes.length} routes</span>
      </section>
      <section className="route-grid" aria-label="Detected routes">
        {visible.map((route, index) => (
          <Link className="route-card" key={route.id} to="/analysis/$routeId" params={{ routeId: route.id }} search={{ ...filters, minimumQuality: 65, windowLength: 1, mode: 'representative' }}>
            <div className="route-card-map"><RouteThumbnail points={route.geometry} linkAttribution={false} /><span className="route-rank">{String(index + 1).padStart(2, '0')}</span></div>
            <div className="route-card-body">
              <div className="route-card-title"><span className={`route-type route-type-${route.type}`}>{route.type === 'loop' ? <Repeat2 /> : <RouteIcon />}{route.type}</span><span>{route.sport}</span></div>
              <h2>{route.name}</h2>
              <dl className="route-stats"><div><dt>Distance</dt><dd>{distance(route.distanceM)}</dd></div><div><dt>Workouts</dt><dd>{route.workoutCount}</dd></div><div><dt>{route.type === 'loop' ? 'Laps' : 'Traversals'}</dt><dd>{route.traversalCount}</dd></div><div><dt>Match</dt><dd>{Math.round(route.matchScore * 100)}%</dd></div></dl>
              <span className="inspect-route"><Flag />Inspect route</span>
            </div>
          </Link>
        ))}
      </section>
    </>
  )
}
