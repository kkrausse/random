import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { AnnotatedRouteMap } from './AnnotatedRouteMap'

describe('AnnotatedRouteMap', () => {
  test('projects selectable analysis geometry over the complete workout', () => {
    const html = renderToStaticMarkup(<AnnotatedRouteMap
      label="Workout with one matched segment"
      points={[{ lat: 37, lon: -122 }, { lat: 37.01, lon: -121.99 }, { lat: 37.02, lon: -121.98 }]}
      annotations={[{ id: 'segment-1', label: 'Creek climb', color: '#b8f34b', points: [{ lat: 37.005, lon: -121.995 }, { lat: 37.015, lon: -121.985 }] }]}
      selectedId="segment-1"
      onSelect={() => undefined}
    />)

    expect(html).toContain('aria-label="Workout with one matched segment"')
    expect(html).toContain('aria-label="Select Creek climb"')
    expect(html).toContain('map-annotation is-selected')
    expect(html).not.toContain('NaN')
  })
})
