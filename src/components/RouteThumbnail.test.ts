import { describe, expect, test } from 'bun:test'

import { routePath } from './RouteThumbnail'

describe('routePath', () => {
  test('returns no path without a route', () => {
    expect(routePath([])).toBeNull()
    expect(routePath([{ lat: 1, lon: 2 }])).toBeNull()
  })

  test('projects a route into finite SVG coordinates', () => {
    const path = routePath([
      { lat: 40.7, lon: -74.01 },
      { lat: 40.71, lon: -74 },
      { lat: 40.72, lon: -74.02 },
    ])
    expect(path).toStartWith('M')
    expect(path).not.toContain('NaN')
    expect(path).not.toContain('Infinity')
  })
})
