const TILE_SIZE = 256
const MAX_LATITUDE = 85.051129

export interface GeographicPoint {
  readonly lat: number
  readonly lon: number
}

export interface RouteMapTile {
  readonly href: string
  readonly x: number
  readonly y: number
}

export interface ProjectedRouteMap {
  readonly path: string
  readonly tiles: ReadonlyArray<RouteMapTile>
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>
  readonly start: { readonly x: number; readonly y: number }
  readonly end: { readonly x: number; readonly y: number }
  readonly worldSize: number
  readonly originX: number
  readonly originY: number
}

const coordinate = (value: number) => Number(value.toFixed(3))

export const projectGeographicPoint = (point: GeographicPoint) => {
  const latitude = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, point.lat))
  const sin = Math.sin((latitude * Math.PI) / 180)
  return {
    x: (point.lon + 180) / 360,
    y: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI),
  }
}

/** Fits a complete route into a fixed pixel viewport using the same Web Mercator space as OSM tiles. */
export const createRouteMap = (points: ReadonlyArray<GeographicPoint>, width: number, height: number, padding = 7): ProjectedRouteMap | null => {
  if (points.length < 2) return null

  const projected = points.map(projectGeographicPoint)
  const minX = Math.min(...projected.map((point) => point.x))
  const maxX = Math.max(...projected.map((point) => point.x))
  const minY = Math.min(...projected.map((point) => point.y))
  const maxY = Math.max(...projected.map((point) => point.y))
  const availableWidth = width - padding * 2
  const availableHeight = height - padding * 2
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
  const tiles: RouteMapTile[] = []

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
