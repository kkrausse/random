import type { RouteDetail as RouteDetailValue } from '../domain/analysis'
import { LoopRouteDetail } from './LoopRouteDetail'
import { SegmentRouteDetail } from './SegmentRouteDetail'

export type DetailControls = {
  minimumQuality: number
  windowLength: 1 | 3 | 5 | 10
  mode: 'representative' | 'best' | 'all'
}

export function RouteDetail({ route, controls, onControlsChange }: {
  route: RouteDetailValue
  controls: DetailControls
  onControlsChange: (controls: Partial<DetailControls>) => void
}) {
  return route.type === 'loop'
    ? <LoopRouteDetail route={route} controls={controls} onControlsChange={onControlsChange} />
    : <SegmentRouteDetail route={route} minimumQuality={controls.minimumQuality} onMinimumQualityChange={(minimumQuality) => onControlsChange({ minimumQuality })} />
}
