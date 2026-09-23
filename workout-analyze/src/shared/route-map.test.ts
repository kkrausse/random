import { describe, expect, test } from 'bun:test'

import { createRouteMap } from './route-map'

describe('createRouteMap', () => {
  test('fits a ride wider than the old fixed viewport without clipping either endpoint', () => {
    const map = createRouteMap([
      { lat: 37.77, lon: -122.44 },
      { lat: 37.775, lon: -122.421 },
      { lat: 37.78, lon: -122.402 },
    ], 320, 220, 18)

    expect(map).not.toBeNull()
    expect(map!.points.every(({ x, y }) => x >= 0 && x <= 320 && y >= 0 && y <= 220)).toBeTrue()
    expect(Math.abs(map!.end.x - map!.start.x)).toBeGreaterThan(150)
    expect(map!.tiles.length).toBeGreaterThan(0)
    expect(map!.tiles[0]?.href).toContain('World_Topo_Map/MapServer/tile/')
    expect(map!.tiles.some((tile) => tile.x < 0)).toBeTrue()
  })
})
