import type { RoutePoint } from '../domain/activity'

const WIDTH = 132
const HEIGHT = 64
const PADDING = 7

export function routePath(points: ReadonlyArray<RoutePoint>): string | null {
  if (points.length < 2) return null
  const minLat = Math.min(...points.map((point) => point.lat))
  const maxLat = Math.max(...points.map((point) => point.lat))
  const centerLat = (minLat + maxLat) / 2
  const lonScale = Math.max(Math.cos((centerLat * Math.PI) / 180), 0.01)
  const projected = points.map((point) => ({ x: point.lon * lonScale, y: -point.lat }))
  const minX = Math.min(...projected.map((point) => point.x))
  const maxX = Math.max(...projected.map((point) => point.x))
  const minY = Math.min(...projected.map((point) => point.y))
  const maxY = Math.max(...projected.map((point) => point.y))
  const scale = Math.min(
    (WIDTH - PADDING * 2) / Math.max(maxX - minX, 0.000001),
    (HEIGHT - PADDING * 2) / Math.max(maxY - minY, 0.000001),
  )
  const offsetX = (WIDTH - (maxX - minX) * scale) / 2
  const offsetY = (HEIGHT - (maxY - minY) * scale) / 2

  return projected
    .map((point, index) =>
      `${index === 0 ? 'M' : 'L'}${((point.x - minX) * scale + offsetX).toFixed(1)},${((point.y - minY) * scale + offsetY).toFixed(1)}`,
    )
    .join(' ')
}

export function RouteThumbnail({ points }: { points: ReadonlyArray<RoutePoint> }) {
  const path = routePath(points)
  return (
    <svg className="route-thumbnail" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={path ? 'Workout route' : 'No GPS route'}>
      <rect width={WIDTH} height={HEIGHT} rx="3" />
      {path ? <path d={path} /> : <line x1="54" y1="32" x2="78" y2="32" />}
    </svg>
  )
}
