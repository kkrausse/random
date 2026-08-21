import type { RoutePoint } from '../domain/activity'

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
  readonly start: { readonly x: number, readonly y: number }
  readonly end: { readonly x: number, readonly y: number }
}

const project = (point: RoutePoint) => {
  const latitude = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, point.lat))
  const sin = Math.sin((latitude * Math.PI) / 180)
  return {
    x: (point.lon + 180) / 360,
    y: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI),
  }
}

function routeMap(points: ReadonlyArray<RoutePoint>): RouteMap | null {
  if (points.length < 2) return null

  const projected = points.map(project)
  const minX = Math.min(...projected.map((point) => point.x))
  const maxX = Math.max(...projected.map((point) => point.x))
  const minY = Math.min(...projected.map((point) => point.y))
  const maxY = Math.max(...projected.map((point) => point.y))
  const availableWidth = WIDTH - PADDING * 2
  const availableHeight = HEIGHT - PADDING * 2
  const fitScale = Math.min(
    availableWidth / Math.max((maxX - minX) * TILE_SIZE, 0.000001),
    availableHeight / Math.max((maxY - minY) * TILE_SIZE, 0.000001),
  )
  const zoom = Math.max(1, Math.min(18, Math.floor(Math.log2(fitScale))))
  const worldSize = TILE_SIZE * 2 ** zoom
  const centerX = ((minX + maxX) / 2) * worldSize
  const centerY = ((minY + maxY) / 2) * worldSize
  const originX = centerX - WIDTH / 2
  const originY = centerY - HEIGHT / 2
  const tileCount = 2 ** zoom
  const tiles: MapTile[] = []

  for (let tileY = Math.floor(originY / TILE_SIZE); tileY <= Math.floor((originY + HEIGHT) / TILE_SIZE); tileY += 1) {
    if (tileY < 0 || tileY >= tileCount) continue
    for (let tileX = Math.floor(originX / TILE_SIZE); tileX <= Math.floor((originX + WIDTH) / TILE_SIZE); tileX += 1) {
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
    start: screenPoints[0]!,
    end: screenPoints.at(-1)!,
  }
}

export function routePath(points: ReadonlyArray<RoutePoint>): string | null {
  return routeMap(points)?.path ?? null
}

export function RouteThumbnail({ points }: { points: ReadonlyArray<RoutePoint> }) {
  const map = routeMap(points)

  return (
    <div className="route-thumbnail" role="img" aria-label={map ? 'Workout route on a map' : 'No GPS route'}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true">
        <rect className="route-background" width={WIDTH} height={HEIGHT} rx="3" />
        {map?.tiles.map((tile) => (
          <image key={tile.href} href={tile.href} x={tile.x} y={tile.y} width={TILE_SIZE} height={TILE_SIZE} />
        ))}
        {map ? <path d={map.path} /> : <line x1="54" y1="32" x2="78" y2="32" />}
        {map && <g className="route-endpoints">
          <circle className="route-endpoint-end" cx={map.end.x} cy={map.end.y} r="3.2" />
          <circle className="route-endpoint-start" cx={map.start.x} cy={map.start.y} r="2.2" />
        </g>}
      </svg>
      {map && <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>}
    </div>
  )
}
