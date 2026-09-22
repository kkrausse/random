import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { AnnotatedRouteMap } from './AnnotatedRouteMap'

// Read-only fixture from normalized activity garmin:24076634383 and its stored
// segment-bc473af3d375b7b56029 geometry in data/fitness.duckdb.
const workout = [
  { lat: 37.774732913821936, lon: -122.45849071070552 },
  { lat: 37.76702047325671, lon: -122.4946173839271 },
  { lat: 37.76711627840996, lon: -122.49488040804863 },
  { lat: 37.767797224223614, lon: -122.4914372060448 },
  { lat: 37.76738123036921, lon: -122.4951702542603 },
  { lat: 37.76701854541898, lon: -122.4946300406009 },
  { lat: 37.76913782581687, lon: -122.4887875188142 },
  { lat: 37.7760161831975, lon: -122.45806608349085 },
]
const segment = [
  { lat: 37.774016771930675, lon: -122.45846239723494 },
  { lat: 37.77200634962289, lon: -122.46190645375808 },
  { lat: 37.77269207051043, lon: -122.46622940308572 },
  { lat: 37.77158369094204, lon: -122.4703786439602 },
  { lat: 37.771494932186364, lon: -122.47439921976554 },
  { lat: 37.77100415102883, lon: -122.47870608559198 },
  { lat: 37.7693057025978, lon: -122.48214100024673 },
  { lat: 37.768380990393496, lon: -122.48555502027772 },
]

describe('AnnotatedRouteMap', () => {
  test('projects a real matched segment over its complete normalized workout', () => {
    const html = renderToStaticMarkup(<AnnotatedRouteMap
      label="Workout with one matched segment"
      points={workout}
      annotations={[{ id: 'segment-bc473af3d375b7b56029', label: 'Westbound segment', color: '#b8f34b', points: segment }]}
      selectedId="segment-bc473af3d375b7b56029"
      onSelect={() => undefined}
    />)

    expect(html).toContain('aria-label="Workout with one matched segment"')
    expect(html).toContain('aria-label="Select Westbound segment"')
    expect(html).toContain('map-annotation is-selected')
    expect(html).toContain('<image')
    expect(html.indexOf('<image')).toBeLessThan(html.indexOf('annotated-base-shadow'))
    expect(html).not.toContain('NaN')
    expect(html.indexOf('annotated-base')).toBeLessThan(html.indexOf('map-annotation is-selected'))
    const annotationPath = html.match(/map-annotation-line" d="([^"]+)/)?.[1]
    expect(annotationPath).toBeTruthy()
    const coordinates = [...annotationPath!.matchAll(/[ML]([\d.-]+),([\d.-]+)/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }))
    expect(coordinates).toHaveLength(segment.length)
    expect(coordinates.every(({ x, y }) => x >= 0 && x <= 320 && y >= 0 && y <= 210)).toBe(true)
  })
})
