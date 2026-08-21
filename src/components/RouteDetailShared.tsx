import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'

import type { RouteDetail } from '../domain/analysis'
import { RouteThumbnail } from './RouteThumbnail'

export const duration = (seconds: number) => {
  const rounded = Math.round(seconds)
  const minutes = Math.floor(rounded / 60)
  return `${minutes}:${String(rounded % 60).padStart(2, '0')}`
}

export const distance = (meters: number) => meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`
export const speed = (metersPerSecond: number | null) => metersPerSecond === null ? '-' : `${(metersPerSecond * 3.6).toFixed(1)} km/h`

export function DetailHero({ route }: { route: RouteDetail }) {
  return (
    <>
      <Link className="back-link" to="/analysis"><ArrowLeft />All detected routes</Link>
      <section className="detail-hero">
        <div className="detail-map"><RouteThumbnail points={route.geometry} /></div>
        <div className="detail-summary"><p className="eyebrow">{route.sport} / {route.type}</p><h1>{route.name}</h1><dl className="hero-stats"><div><dt>Distance</dt><dd>{distance(route.distanceM)}</dd></div><div><dt>Workouts</dt><dd>{route.workoutCount}</dd></div><div><dt>Match strength</dt><dd>{Math.round(route.matchScore * 100)}%</dd></div><div><dt>Date range</dt><dd>{new Date(route.firstTraversalAt).toLocaleDateString()} - {new Date(route.lastTraversalAt).toLocaleDateString()}</dd></div></dl></div>
      </section>
    </>
  )
}

export function QualityControl({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return <label>Minimum quality <span>{value}%</span><input type="range" min="50" max="100" step="1" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>
}

function Trend({ label, values, format }: { label: string; values: ReadonlyArray<number>; format: (value: number) => string }) {
  if (values.length === 0) return null
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const range = Math.max(maximum - minimum, 1)
  const points = values.map((value, index) => `${values.length === 1 ? 50 : index / (values.length - 1) * 100},${44 - (value - minimum) / range * 36}`).join(' ')
  return <div className="trend"><span>{label}</span><strong>{format(values.at(-1)!)}</strong><svg viewBox="0 0 100 48" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} /></svg><small>{format(minimum)} - {format(maximum)}</small></div>
}

export function DetailTrends({ efforts }: { efforts: RouteDetail['traversals'] }) {
  const chronological = [...efforts].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  return (
    <section className="trend-grid">
      <Trend label="Elapsed time" values={chronological.map((item) => item.durationSec)} format={duration} />
      <Trend label="Average speed" values={chronological.flatMap((item) => item.avgSpeed === null ? [] : [item.avgSpeed])} format={speed} />
      <Trend label="Average heart rate" values={chronological.flatMap((item) => item.avgHeartRate === null ? [] : [item.avgHeartRate])} format={(value) => `${Math.round(value)} bpm`} />
    </section>
  )
}
