import { ChevronDown, Gauge, HeartPulse, Timer } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Fragment, useState } from 'react'

import type { RouteDetail, RouteTraversal } from '../domain/analysis'
import type { DetailControls } from './RouteDetail'
import { DetailHero, DetailTrends, duration, QualityControl, speed } from './RouteDetailShared'
import { RouteThumbnail } from './RouteThumbnail'

const groupByActivity = (items: ReadonlyArray<RouteTraversal>) => {
  const groups = new Map<string, RouteTraversal[]>()
  for (const item of items) groups.set(item.activityId, [...(groups.get(item.activityId) ?? []), item])
  return groups
}

export function LoopRouteDetail({ route, controls, onControlsChange }: {
  route: RouteDetail
  controls: DetailControls
  onControlsChange: (controls: Partial<DetailControls>) => void
}) {
  const { minimumQuality, windowLength, mode } = controls
  const [expandedEffortIds, setExpandedEffortIds] = useState<Set<string>>(() => new Set())
  const workoutLaps = groupByActivity(route.traversals)
  for (const laps of workoutLaps.values()) laps.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  let efforts = [...route.traversals]

  if (windowLength > 1) {
    efforts = [...groupByActivity(efforts).values()].flatMap((activityLaps) => {
      const laps = activityLaps.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      return laps.flatMap((first, index) => {
        const window = laps.slice(index, index + windowLength)
        if (window.length !== windowLength) return []
        const continuous = window.slice(1).every((lap, lapIndex) => {
          const gap = new Date(lap.startedAt).getTime() - new Date(window[lapIndex]!.endedAt).getTime()
          return gap >= 0 && gap < 120_000
        })
        if (!continuous) return []
        const durationSec = (new Date(window.at(-1)!.endedAt).getTime() - new Date(first.startedAt).getTime()) / 1000
        const heartRateDuration = window.reduce((sum, lap) => sum + (lap.avgHeartRate === null ? 0 : lap.durationSec), 0)
        const distanceM = window.reduce((sum, lap) => sum + lap.distanceM, 0)
        return [{
          ...first,
          id: `${first.id}:window-${windowLength}`,
          endedAt: window.at(-1)!.endedAt,
          durationSec,
          distanceM,
          avgHeartRate: heartRateDuration === 0 ? null : window.reduce((sum, lap) => sum + (lap.avgHeartRate ?? 0) * lap.durationSec, 0) / heartRateDuration,
          avgSpeed: distanceM / durationSec,
          qualityScore: Math.min(...window.map((lap) => lap.qualityScore)),
          lapCount: windowLength,
          lapTimesSec: window.map((lap) => lap.durationSec),
        }]
      })
    })
  }

  if (mode !== 'all') {
    efforts = [...groupByActivity(efforts).values()].flatMap((items) => {
      const selected = [...items].sort((a, b) => mode === 'best'
        ? a.durationSec - b.durationSec
        : b.qualityScore - a.qualityScore)[0]
      return selected ? [selected] : []
    })
  }
  const filtered = efforts.filter((item) => item.qualityScore * 100 >= minimumQuality)

  return (
    <>
      <DetailHero route={route} />
      <section className="analysis-controls">
        <div><p className="eyebrow">Analysis controls</p><h2>Build a comparable effort</h2></div>
        <label>Window length<select value={windowLength} onChange={(event) => { onControlsChange({ windowLength: Number(event.target.value) as DetailControls['windowLength'] }); setExpandedEffortIds(new Set()) }}><option value="1">1 lap</option><option value="3">3 laps</option><option value="5">5 laps</option><option value="10">10 laps</option></select></label>
        <label>Mode<select value={mode} onChange={(event) => { onControlsChange({ mode: event.target.value as DetailControls['mode'] }); setExpandedEffortIds(new Set()) }}><option value="representative">Representative</option><option value="best">Best</option><option value="all">All windows</option></select></label>
        <QualityControl value={minimumQuality} onChange={(value) => onControlsChange({ minimumQuality: value })} />
      </section>
      <DetailTrends efforts={filtered} />
      <section className="effort-table loop-effort-table">
        <div className="section-heading"><div><p className="eyebrow">History</p><h2>Comparable efforts</h2></div><span>{filtered.length} qualifying</span></div>
        <div className="table-scroll"><table><thead><tr><th aria-label="Expand" /><th>Trace</th><th>Date</th><th>Loops</th><th>Time</th><th><HeartPulse /> Avg HR</th><th><Gauge /> Avg speed</th><th>Quality</th><th>Workout</th></tr></thead><tbody>{filtered.map((item) => {
          const expanded = expandedEffortIds.has(item.id)
          const laps = workoutLaps.get(item.activityId) ?? []
          const toggleExpanded = () => setExpandedEffortIds((current) => {
            const next = new Set(current)
            if (next.has(item.id)) next.delete(item.id)
            else next.add(item.id)
            return next
          })
          return <Fragment key={item.id}><tr className="expandable-effort-row" tabIndex={0} aria-expanded={expanded} aria-label={`${expanded ? 'Hide' : 'Show'} all ${laps.length} loops from this workout`} onClick={toggleExpanded} onKeyDown={(event) => { if (event.currentTarget === event.target && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); toggleExpanded() } }}><td className="effort-expand-indicator"><ChevronDown aria-hidden="true" /></td><td className="effort-trace"><Link className="workout-map-link" to="/workouts/$activityId" params={{ activityId: item.activityId }} search={{ at: item.startedAt }} aria-label="Open workout at this effort" onClick={(event) => event.stopPropagation()}><RouteThumbnail points={item.activityRoute} linkAttribution={false} /></Link></td><td>{new Date(item.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td><td className="numeric">{laps.length}</td><td className="numeric"><span className="lap-time"><Timer /> {duration(item.durationSec)}</span></td><td className="numeric hr">{item.avgHeartRate === null ? '-' : Math.round(item.avgHeartRate)}</td><td className="numeric">{speed(item.avgSpeed)}</td><td><span className="quality">{Math.round(item.qualityScore * 100)}%</span></td><td className="numeric"><Link className="workout-link" to="/workouts/$activityId" params={{ activityId: item.activityId }} search={{ at: item.startedAt }} onClick={(event) => event.stopPropagation()}>{item.activityId.replace('garmin:', '#')}</Link></td></tr>{expanded && <><tr className="lap-breakdown-heading"><th /><th aria-label="Trace" /><th>Start time</th><th>Loops</th><th>Time</th><th><HeartPulse /> Avg HR</th><th><Gauge /> Avg speed</th><th>Quality</th><th>Workout</th></tr>{laps.map((lap, index) => <tr className="lap-breakdown-row" key={lap.id}><td /><td /><td className="numeric">{new Date(lap.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</td><td className="numeric">{index + 1}</td><td className="numeric"><Timer /> {duration(lap.durationSec)}</td><td className="numeric hr">{lap.avgHeartRate === null ? '-' : Math.round(lap.avgHeartRate)}</td><td className="numeric">{speed(lap.avgSpeed)}</td><td><span className="quality">{Math.round(lap.qualityScore * 100)}%</span></td><td><Link className="workout-link" to="/workouts/$activityId" params={{ activityId: lap.activityId }} search={{ at: lap.startedAt }}>View point</Link></td></tr>)}</>}</Fragment>
        })}</tbody></table></div>
      </section>
    </>
  )
}
