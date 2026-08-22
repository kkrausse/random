import { Link } from '@tanstack/react-router'

import type { RoutePoint } from '../domain/activity'
import type { RouteType } from '../domain/analysis'

const WIDTH = 132
const HEIGHT = 64
const PADDING = 7
const TILE_SIZE = 256
const MAX_LATITUDE = 85.051129
const coordinate = (value: number) => Number(value.toFixed(3))

interface MapTile {
  readonly href: string
  readonly x: number
  readonly y: number
}

interface RouteMap {
  readonly path: string
  readonly tiles: ReadonlyArray<MapTile>
  readonly points: ReadonlyArray<{ readonly x: number, readonly y: number }>
  readonly start: { readonly x: number, readonly y: number }
  readonly end: { readonly x: number, readonly y: number }
  readonly worldSize: number
  readonly originX: number
  readonly originY: number
}

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

const project = (point: RoutePoint) => {
  const latitude = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, point.lat))
  const sin = Math.sin((latitude * Math.PI) / 180)
  return {
    x: (point.lon + 180) / 360,
    y: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI),
  }
}

function routeMap(points: ReadonlyArray<RoutePoint>, width = WIDTH, height = HEIGHT): RouteMap | null {
  if (points.length < 2) return null

  const projected = points.map(project)
  const minX = Math.min(...projected.map((point) => point.x))
  const maxX = Math.max(...projected.map((point) => point.x))
  const minY = Math.min(...projected.map((point) => point.y))
  const maxY = Math.max(...projected.map((point) => point.y))
  const availableWidth = width - PADDING * 2
  const availableHeight = height - PADDING * 2
  const fitScale = Math.min(
    availableWidth / Math.max((maxX - minX) * TILE_SIZE, 0.000001),
    availableHeight / Math.max((maxY - minY) * TILE_SIZE, 0.000001),
  )
  const zoom = Math.max(1, Math.min(18, Math.floor(Math.log2(fitScale))))
  const worldSize = TILE_SIZE * 2 ** zoom
  const centerX = ((minX + maxX) / 2) * worldSize
  const centerY = ((minY + maxY) / 2) * worldSize
  const originX = centerX - width / 2
  const originY = centerY - height / 2
  const tileCount = 2 ** zoom
  const tiles: MapTile[] = []

  for (let tileY = Math.floor(originY / TILE_SIZE); tileY <= Math.floor((originY + height) / TILE_SIZE); tileY += 1) {
    if (tileY < 0 || tileY >= tileCount) continue
    for (let tileX = Math.floor(originX / TILE_SIZE); tileX <= Math.floor((originX + width) / TILE_SIZE); tileX += 1) {
      const wrappedX = ((tileX % tileCount) + tileCount) % tileCount
      tiles.push({
        href: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${tileY}.png`,
        x: coordinate(tileX * TILE_SIZE - originX),
        y: coordinate(tileY * TILE_SIZE - originY),
      })
    }
  }

  const screenPoints = projected.map((point) => ({
    x: coordinate(point.x * worldSize - originX),
    y: coordinate(point.y * worldSize - originY),
  }))
  return {
    path: screenPoints.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' '),
    tiles,
    points: screenPoints,
    start: screenPoints[0]!,
    end: screenPoints.at(-1)!,
    worldSize,
    originX,
    originY,
  }
}

export function routePath(points: ReadonlyArray<RoutePoint>): string | null {
  return routeMap(points)?.path ?? null
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
  const map = routeMap(points, viewWidth, viewHeight)
  const selected = selectedIndex === undefined ? null : map?.points[selectedIndex]
  const renderedOverlays = map ? overlays.flatMap((overlay) => {
    if (overlay.points.length < 2) return []
    const overlayPoints = overlay.points.map(project).map((point) => ({
      x: coordinate(point.x * map.worldSize - map.originX),
      y: coordinate(point.y * map.worldSize - map.originY),
    }))
    return [{ ...overlay, path: overlayPoints.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ') }]
  }) : []
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
          <image key={tile.href} href={tile.href} x={tile.x} y={tile.y} width={TILE_SIZE} height={TILE_SIZE} />
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
