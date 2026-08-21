import type { RouteDetail as RouteDetailValue } from '../domain/analysis'
import { LoopRouteDetail } from './LoopRouteDetail'
import { SegmentRouteDetail } from './SegmentRouteDetail'

export function RouteDetail({ route }: { route: RouteDetailValue }) {
  return route.type === 'loop' ? <LoopRouteDetail route={route} /> : <SegmentRouteDetail route={route} />
}
