import { Link } from '@tanstack/react-router'
import { ArrowLeft, Gauge, HeartPulse, Timer } from 'lucide-react'
import { useState } from 'react'

import type { RouteDetail as RouteDetailValue, RouteTraversal } from '../domain/analysis'
import { RouteThumbnail } from './RouteThumbnail'

const duration = (seconds: number) => {
  const rounded = Math.round(seconds)
  const minutes = Math.floor(rounded / 60)
  return `${minutes}:${String(rounded % 60).padStart(2, '0')}`
}
const distance = (meters: number) => meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`
const speed = (metersPerSecond: number | null) => metersPerSecond === null ? '-' : `${(metersPerSecond * 3.6).toFixed(1)} km/h`

const groupByActivity = (items: ReadonlyArray<RouteTraversal>) => {
  const groups = new Map<string, RouteTraversal[]>()
  for (const item of items) groups.set(item.activityId, [...(groups.get(item.activityId) ?? []), item])
  return groups
}

function Trend({ label, values, format }: { label: string; values: ReadonlyArray<number>; format: (value: number) => string }) {
  if (values.length === 0) return null
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const range = Math.max(maximum - minimum, 1)
  const points = values.map((value, index) => `${values.length === 1 ? 50 : index / (values.length - 1) * 100},${44 - (value - minimum) / range * 36}`).join(' ')
  return <div className="trend"><span>{label}</span><strong>{format(values.at(-1)!)}</strong><svg viewBox="0 0 100 48" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} /></svg><small>{format(minimum)} - {format(maximum)}</small></div>
}

export function RouteDetail({ route }: { route: RouteDetailValue }) {
  const [minimumQuality, setMinimumQuality] = useState(65)
  const [windowLength, setWindowLength] = useState(1)
  const [mode, setMode] = useState<'representative' | 'best' | 'all'>('representative')
  let efforts = [...route.traversals]
  if (route.type === 'loop' && windowLength > 1) {
    const byActivity = groupByActivity(efforts)
    efforts = [...byActivity.values()].flatMap((activityLaps) => {
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
        return [{
          ...first,
          id: `${first.id}:window-${windowLength}`,
          endedAt: window.at(-1)!.endedAt,
          durationSec,
          distanceM: window.reduce((sum, lap) => sum + lap.distanceM, 0),
          avgHeartRate: heartRateDuration === 0 ? null : window.reduce((sum, lap) => sum + (lap.avgHeartRate ?? 0) * lap.durationSec, 0) / heartRateDuration,
          avgSpeed: window.reduce((sum, lap) => sum + lap.distanceM, 0) / durationSec,
          qualityScore: Math.min(...window.map((lap) => lap.qualityScore)),
          lapCount: windowLength,
          lapTimesSec: window.map((lap) => lap.durationSec),
        }]
      })
    })
  }
  if (route.type === 'loop' && mode !== 'all') {
    efforts = [...groupByActivity(efforts).values()].flatMap((items) => {
      const selected = [...items].sort((a, b) => mode === 'best'
        ? a.durationSec - b.durationSec
        : b.qualityScore - a.qualityScore)[0]
      return selected ? [selected] : []
    })
  }
  const filtered = efforts.filter((item) => item.qualityScore * 100 >= minimumQuality)
  const chronological = [...filtered].sort((a, b) => a.startedAt.localeCompare(b.startedAt))

  return (
    <>
      <Link className="back-link" to="/analysis"><ArrowLeft />All detected routes</Link>
      <section className="detail-hero">
        <div className="detail-map"><RouteThumbnail points={route.geometry} /></div>
        <div className="detail-summary"><p className="eyebrow">{route.sport} / {route.type}</p><h1>{route.name}</h1><dl className="hero-stats"><div><dt>Distance</dt><dd>{distance(route.distanceM)}</dd></div><div><dt>Workouts</dt><dd>{route.workoutCount}</dd></div><div><dt>Match strength</dt><dd>{Math.round(route.matchScore * 100)}%</dd></div><div><dt>Date range</dt><dd>{new Date(route.firstTraversalAt).toLocaleDateString()} - {new Date(route.lastTraversalAt).toLocaleDateString()}</dd></div></dl></div>
      </section>
      <section className="analysis-controls">
        <div><p className="eyebrow">Analysis controls</p><h2>{route.type === 'loop' ? 'Build a comparable effort' : 'Filter comparable efforts'}</h2></div>
        {route.type === 'loop' && <><label>Window length<select value={windowLength} onChange={(event) => setWindowLength(Number(event.target.value))}><option value="1">1 lap</option><option value="3">3 laps</option><option value="5">5 laps</option><option value="10">10 laps</option></select></label><label>Mode<select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="representative">Representative</option><option value="best">Best</option><option value="all">All windows</option></select></label></>}
        <label>Minimum quality <span>{minimumQuality}%</span><input type="range" min="50" max="100" step="1" value={minimumQuality} onChange={(event) => setMinimumQuality(Number(event.target.value))} /></label>
      </section>
      <section className="trend-grid">
        <Trend label="Elapsed time" values={chronological.map((item) => item.durationSec)} format={duration} />
        <Trend label="Average speed" values={chronological.flatMap((item) => item.avgSpeed === null ? [] : [item.avgSpeed])} format={speed} />
        <Trend label="Average heart rate" values={chronological.flatMap((item) => item.avgHeartRate === null ? [] : [item.avgHeartRate])} format={(value) => `${Math.round(value)} bpm`} />
      </section>
      <section className="effort-table">
        <div className="section-heading"><div><p className="eyebrow">History</p><h2>{route.type === 'loop' ? 'Comparable efforts' : 'Traversals'}</h2></div><span>{filtered.length} qualifying</span></div>
        <div className="table-scroll"><table><thead><tr><th>Date</th><th>Time</th><th><HeartPulse /> Avg HR</th><th><Gauge /> Avg speed</th><th>Quality</th><th>Workout</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td>{new Date(item.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td><td className="numeric"><Timer /> {duration(item.durationSec)}</td><td className="numeric hr">{item.avgHeartRate === null ? '-' : Math.round(item.avgHeartRate)}</td><td className="numeric">{speed(item.avgSpeed)}</td><td><span className="quality">{Math.round(item.qualityScore * 100)}%</span></td><td className="numeric">{item.activityId.replace('garmin:', '#')}</td></tr>)}</tbody></table></div>
      </section>
    </>
  )
}
