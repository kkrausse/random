import { Link } from '@tanstack/react-router'

import type { RoutePoint } from '../domain/activity'
import type { RouteType } from '../domain/analysis'
import { createRouteMap, projectPointsIntoRouteMap, routePathFromProjectedPoints } from '../shared/route-map'

const WIDTH = 132
const HEIGHT = 64
const PADDING = 7

export interface RouteOverlay {
  readonly id: string
  readonly routeId: string
  readonly name: string
  readonly type: RouteType
  readonly sport: string
  readonly distanceM: number
  readonly workoutCount: number
  readonly traversalCount: number
  readonly matchScore: number
  readonly points: ReadonlyArray<RoutePoint>
  readonly color: string
}

export interface OverlayPosition {
  readonly x: number
  readonly y: number
}

const distance = (meters: number) => meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`

export function routePath(points: ReadonlyArray<RoutePoint>): string | null {
  return createRouteMap(points, WIDTH, HEIGHT, PADDING)?.path ?? null
}

export function RouteThumbnail({ points, linkAttribution = true, selectedIndex, viewWidth = WIDTH, viewHeight = HEIGHT, overlays = [], activeOverlayId, onOverlayChange, onOverlaySelect }: {
  points: ReadonlyArray<RoutePoint>
  linkAttribution?: boolean
  selectedIndex?: number
  viewWidth?: number
  viewHeight?: number
  overlays?: ReadonlyArray<RouteOverlay>
  activeOverlayId?: string | null
  onOverlayChange?: (id: string | null, position?: OverlayPosition) => void
  onOverlaySelect?: (routeId: string) => void
}) {
  const map = createRouteMap(points, viewWidth, viewHeight, PADDING)
  const selected = selectedIndex === undefined ? null : map?.points[selectedIndex]
  const renderedOverlays = map ? overlays.flatMap((overlay) => {
    if (overlay.points.length < 2) return []
    const overlayPoints = projectPointsIntoRouteMap(overlay.points, map)
    return [{ ...overlay, path: routePathFromProjectedPoints(overlayPoints) }]
  }).sort((a, b) => b.distanceM - a.distanceM) : []
  const activeOverlay = overlays.find((overlay) => overlay.id === activeOverlayId)

  const updateOverlay = (id: string, event: React.PointerEvent<SVGPathElement>) => {
    const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect()
    if (!bounds) return onOverlayChange?.(id)
    onOverlayChange?.(id, {
      x: Math.max(8, Math.min(92, ((event.clientX - bounds.left) / bounds.width) * 100)),
      y: Math.max(10, Math.min(90, ((event.clientY - bounds.top) / bounds.height) * 100)),
    })
  }

  return (
    <div className="route-thumbnail" role={overlays.length === 0 ? 'img' : undefined} aria-label={map ? 'Workout route on a map' : 'No GPS route'} onPointerLeave={() => onOverlayChange?.(null)}>
      <svg viewBox={`0 0 ${viewWidth} ${viewHeight}`} aria-hidden={overlays.length === 0 ? 'true' : undefined}>
        <rect className="route-background" width={viewWidth} height={viewHeight} rx="3" />
        {map?.tiles.map((tile) => (
          <image key={tile.href} href={tile.href} x={tile.x} y={tile.y} width={256} height={256} />
        ))}
        {map ? <path className="route-main-path" d={map.path} /> : <line x1="54" y1="32" x2="78" y2="32" />}
        {renderedOverlays.map((overlay) => <g key={overlay.id} className={overlay.id === activeOverlayId ? 'route-overlay is-active' : 'route-overlay'}>
          <path className="route-overlay-visible" d={overlay.path} style={{ stroke: overlay.color }} />
          <path
            className="route-overlay-hit-area"
            d={overlay.path}
            role="link"
            tabIndex={0}
            aria-label={`View ${overlay.name}`}
            onPointerEnter={(event) => updateOverlay(overlay.id, event)}
            onPointerMove={(event) => updateOverlay(overlay.id, event)}
            onPointerLeave={() => onOverlayChange?.(null)}
            onClick={() => onOverlaySelect?.(overlay.routeId)}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onOverlaySelect?.(overlay.routeId) }}
          />
        </g>)}
        {map && <g className="route-endpoints">
          <circle className="route-endpoint-end" cx={map.end.x} cy={map.end.y} r="3.2" />
          <circle className="route-endpoint-start" cx={map.start.x} cy={map.start.y} r="2.2" />
        </g>}
        {selected && <circle className="route-current-point" cx={selected.x} cy={selected.y} r="7" />}
      </svg>
      {activeOverlay && <Link
        className="segment-map-tooltip"
        to="/analysis/$routeId"
        params={{ routeId: activeOverlay.routeId }}
        search={{ type: 'all', sport: 'all', minimumWorkouts: 2, minimumQuality: 65, windowLength: 1, mode: 'representative' }}
        onPointerEnter={() => onOverlayChange?.(activeOverlay.id)}
        onPointerLeave={() => onOverlayChange?.(null)}
      >
        <RouteThumbnail points={activeOverlay.points} linkAttribution={false} />
        <span className="segment-map-tooltip-body">
          <span className="segment-map-tooltip-title"><span><i style={{ backgroundColor: activeOverlay.color }} />{activeOverlay.type}</span><span>{activeOverlay.sport}</span></span>
          <strong>{activeOverlay.name}</strong>
          <span className="route-stats">
            <span><small>Distance</small><b>{distance(activeOverlay.distanceM)}</b></span>
            <span><small>Workouts</small><b>{activeOverlay.workoutCount}</b></span>
            <span><small>{activeOverlay.type === 'loop' ? 'Laps' : 'Traversals'}</small><b>{activeOverlay.traversalCount}</b></span>
            <span><small>Match</small><b>{Math.round(activeOverlay.matchScore * 100)}%</b></span>
          </span>
          <small className="segment-map-tooltip-action">Open route</small>
        </span>
      </Link>}
      {map && (linkAttribution
        ? <a className="map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>
        : <span className="map-attribution">© OpenStreetMap</span>)}
    </div>
  )
}
