import { Gauge, HeartPulse, Timer } from 'lucide-react'
import { useState } from 'react'

import type { RouteDetail } from '../domain/analysis'
import { DetailHero, DetailTrends, duration, QualityControl, speed } from './RouteDetailShared'
import { RouteThumbnail } from './RouteThumbnail'

export function SegmentRouteDetail({ route }: { route: RouteDetail }) {
  const [minimumQuality, setMinimumQuality] = useState(65)
  const efforts = route.traversals.filter((item) => item.qualityScore * 100 >= minimumQuality)
  const workoutTraversalCounts = new Map<string, number>()
  for (const traversal of route.traversals) {
    workoutTraversalCounts.set(traversal.activityId, (workoutTraversalCounts.get(traversal.activityId) ?? 0) + 1)
  }

  return (
    <>
      <DetailHero route={route} />
      <section className="analysis-controls">
        <div><p className="eyebrow">Analysis controls</p><h2>Filter comparable efforts</h2></div>
        <QualityControl value={minimumQuality} onChange={setMinimumQuality} />
      </section>
      <DetailTrends efforts={efforts} />
      <section className="effort-table">
        <div className="section-heading"><div><p className="eyebrow">History</p><h2>Traversals</h2></div><span>{efforts.length} qualifying</span></div>
        <div className="table-scroll"><table><thead><tr><th>Trace</th><th>Date</th><th>Passes</th><th>Time</th><th><HeartPulse /> Avg HR</th><th><Gauge /> Avg speed</th><th>Quality</th><th>Workout</th></tr></thead><tbody>{efforts.map((item) => <tr key={item.id}><td className="effort-trace"><RouteThumbnail points={item.activityRoute} /></td><td>{new Date(item.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td><td className="numeric">{workoutTraversalCounts.get(item.activityId) ?? 1}</td><td className="numeric"><Timer /> {duration(item.durationSec)}</td><td className="numeric hr">{item.avgHeartRate === null ? '-' : Math.round(item.avgHeartRate)}</td><td className="numeric">{speed(item.avgSpeed)}</td><td><span className="quality">{Math.round(item.qualityScore * 100)}%</span></td><td className="numeric">{item.activityId.replace('garmin:', '#')}</td></tr>)}</tbody></table></div>
      </section>
    </>
  )
}
