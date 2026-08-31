import { Gauge, HeartPulse, Timer } from 'lucide-react'
import { Link } from '@tanstack/react-router'

import type { RouteDetail } from '../domain/analysis'
import { DetailHero, DetailTrends, duration, QualityControl, speed } from './RouteDetailShared'
import { RouteThumbnail } from './RouteThumbnail'

function SupportProfile({ route }: { route: RouteDetail }) {
  if (route.supportProfile.length === 0) return null
  const peak = Math.max(...route.supportProfile.map((point) => point.workoutCount))
  const distanceM = Math.max(route.distanceM, 1)
  const points = route.supportProfile.map((point) =>
    `${point.distanceM / distanceM * 100},${46 - point.workoutCount / Math.max(1, peak) * 38}`).join(' ')
  return (
    <section className="support-profile">
      <div className="section-heading"><div><p className="eyebrow">Route coverage</p><h2>Workout support by distance</h2></div><span>{route.workoutCount} full / {peak} peak workouts</span></div>
      <svg viewBox="0 0 100 50" preserveAspectRatio="none" role="img" aria-label={`Support rises from ${route.workoutCount} full-route workouts to a peak of ${peak}`}>
        <polygon points={`0,46 ${points} 100,46`} />
        <polyline points={points} />
      </svg>
      <div className="support-axis"><span>Start</span><span>{Math.round(route.distanceM)} m</span></div>
    </section>
  )
}

export function SegmentRouteDetail({ route, minimumQuality, onMinimumQualityChange }: {
  route: RouteDetail
  minimumQuality: number
  onMinimumQualityChange: (minimumQuality: number) => void
}) {
  const efforts = route.traversals.filter((item) => item.qualityScore * 100 >= minimumQuality)
  const workoutTraversalCounts = new Map<string, number>()
  for (const traversal of route.traversals) {
    workoutTraversalCounts.set(traversal.activityId, (workoutTraversalCounts.get(traversal.activityId) ?? 0) + 1)
  }

  return (
    <>
      <DetailHero route={route} />
      <SupportProfile route={route} />
      <section className="analysis-controls">
        <div><p className="eyebrow">Analysis controls</p><h2>Filter comparable efforts</h2></div>
        <QualityControl value={minimumQuality} onChange={onMinimumQualityChange} />
      </section>
      <DetailTrends efforts={efforts} />
      <section className="effort-table">
        <div className="section-heading"><div><p className="eyebrow">History</p><h2>Traversals</h2></div><span>{efforts.length} qualifying</span></div>
        <div className="table-scroll"><table><thead><tr><th>Trace</th><th>Date</th><th>Passes</th><th>Time</th><th><HeartPulse /> Avg HR</th><th><Gauge /> Avg speed</th><th>Quality</th><th>Workout</th></tr></thead><tbody>{efforts.map((item) => <tr key={item.id}><td className="effort-trace"><Link className="workout-map-link" to="/workouts/$activityId" params={{ activityId: item.activityId }} search={{ at: item.startedAt }} aria-label="Open workout at this traversal"><RouteThumbnail points={item.activityRoute} linkAttribution={false} /></Link></td><td>{new Date(item.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td><td className="numeric">{workoutTraversalCounts.get(item.activityId) ?? 1}</td><td className="numeric"><Timer /> {duration(item.durationSec)}</td><td className="numeric hr">{item.avgHeartRate === null ? '-' : Math.round(item.avgHeartRate)}</td><td className="numeric">{speed(item.avgSpeed)}</td><td><span className="quality">{Math.round(item.qualityScore * 100)}%</span></td><td className="numeric"><Link className="workout-link" to="/workouts/$activityId" params={{ activityId: item.activityId }} search={{ at: item.startedAt }}>{item.activityId.replace('garmin:', '#')}</Link></td></tr>)}</tbody></table></div>
      </section>
    </>
  )
}
