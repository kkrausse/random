import { describe, expect, test } from 'bun:test'
import { constrainMapTransform, movedBeyondClickThreshold, zoomAt } from './MapViewport'

describe('map viewport interaction math', () => {
  test('keeps the geographic point beneath the zoom anchor stationary', () => {
    const before = { scale: 2, x: -30, y: 12 }
    const anchor = { x: 80, y: 50 }
    const contentPoint = { x: (anchor.x - before.x) / before.scale, y: (anchor.y - before.y) / before.scale }
    const after = zoomAt(before, 4, anchor)

    expect(contentPoint.x * after.scale + after.x).toBeCloseTo(anchor.x)
    expect(contentPoint.y * after.scale + after.y).toBeCloseTo(anchor.y)
  })

  test('clamps zoom and distinguishes taps from drags', () => {
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, 99, { x: 0, y: 0 }).scale).toBe(6)
    expect(zoomAt({ scale: 2, x: 0, y: 0 }, 0.1, { x: 0, y: 0 }).scale).toBe(0.5)
    expect(movedBeyondClickThreshold(5.9)).toBe(false)
    expect(movedBeyondClickThreshold(6)).toBe(true)
  })

  test('bounds panning while allowing the fitted route to move over surrounding tiles', () => {
    expect(constrainMapTransform({ scale: 2, x: 20, y: -999 }, { width: 320, height: 190 })).toEqual({ scale: 2, x: 0, y: -190 })
    expect(constrainMapTransform({ scale: 1, x: -80, y: -40 }, { width: 320, height: 190 })).toEqual({ scale: 1, x: -80, y: -40 })
    expect(constrainMapTransform({ scale: 0.5, x: -80, y: -40 }, { width: 320, height: 190 })).toEqual({ scale: 0.5, x: 0, y: 0 })
    expect(constrainMapTransform({ scale: 0.5, x: 999, y: 999 }, { width: 320, height: 190 })).toEqual({ scale: 0.5, x: 160, y: 95 })
  })
})
