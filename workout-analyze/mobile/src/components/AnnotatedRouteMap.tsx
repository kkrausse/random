import { MapPin } from 'lucide-react'
import type { RoutePoint } from '../../../src/domain/activity'
import { createRouteMap, projectPointsIntoRouteMap, routePathFromProjectedPoints } from '../../../src/shared/route-map'

export const segmentColors = ['#b8f34b', '#80c7ff', '#f7c85c', '#e987ff', '#47d7d0', '#ff8b67', '#ff79ad', '#b4d56b'] as const

export interface MapAnnotation {
  readonly id: string
  readonly label: string
  readonly points: ReadonlyArray<RoutePoint>
  readonly color: string
}

export const AnnotatedRouteMap = ({ points, annotations = [], selectedId, onSelect, label }: {
  points: ReadonlyArray<RoutePoint>
  annotations?: ReadonlyArray<MapAnnotation>
  selectedId?: string | null
  onSelect?: (id: string) => void
  label: string
}) => {
  const map = createRouteMap(points, 320, 210, 16)
  if (!map) return <div className="annotated-map map-empty"><MapPin /><strong>Route unavailable</strong></div>
  const projected = annotations.filter((item) => item.points.length > 1).map((item) => ({
    ...item,
    path: routePathFromProjectedPoints(projectPointsIntoRouteMap(item.points, map)),
  })).sort((left, right) => Number(left.id === selectedId) - Number(right.id === selectedId))

  return <div className="annotated-map" aria-label={label}>
    {map.tiles.map((tile) => <img key={`${tile.href}-${tile.x}-${tile.y}`} src={tile.href} alt="" style={{ left: tile.x, top: tile.y }} />)}
    <svg viewBox="0 0 320 210" preserveAspectRatio="none">
      <path className="annotated-base-shadow" d={map.path} />
      <path className="annotated-base" d={map.path} />
      {projected.map((item) => <g key={item.id} className={item.id === selectedId ? 'map-annotation is-selected' : 'map-annotation'}>
        <path className="map-annotation-line" d={item.path} style={{ stroke: item.color }} />
        <path className="map-annotation-hit" d={item.path} role="button" tabIndex={0} aria-label={`Select ${item.label}`} onClick={() => onSelect?.(item.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelect?.(item.id) }} />
      </g>)}
      <circle className="route-start" cx={map.start.x} cy={map.start.y} r="4" />
      <circle className="route-finish" cx={map.end.x} cy={map.end.y} r="5" />
    </svg>
    <small className="attribution">© OpenStreetMap contributors</small>
  </div>
}
