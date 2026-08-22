import { Link, useNavigate } from '@tanstack/react-router'
import { Gauge, HeartPulse, MapPin, Mountain, Repeat2, Route as RouteIcon, Timer } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { WorkoutDetail as WorkoutDetailData, WorkoutSample } from '../domain/activity'
import type { WorkoutRouteMatch } from '../domain/analysis'
import { AppNav } from './AppNav'
import { RouteThumbnail } from './RouteThumbnail'
import type { OverlayPosition, RouteOverlay } from './RouteThumbnail'

const miles = (meters: number) => meters / 1609.344
const segmentColors = ['#244b63', '#28647a', '#287d89', '#2a9488', '#43a47e', '#68b575', '#92c36b', '#b8cc68']

const elapsed = (workout: WorkoutDetailData, sample: WorkoutSample) => {
  if (!sample.timestamp) return null
  return Math.max(0, (new Date(sample.timestamp).getTime() - new Date(workout.startedAt).getTime()) / 1000)
}

const duration = (seconds: number | null) => {
  if (seconds === null) return '-'
  const rounded = Math.round(seconds)
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const remainder = rounded % 60
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${minutes}:${String(remainder).padStart(2, '0')}`
}

const nearestSampleIndex = (samples: ReadonlyArray<WorkoutSample>, target: string | undefined) => {
  if (!target) return 0
  const targetTime = new Date(target).getTime()
  if (!Number.isFinite(targetTime)) return 0
  let nearest = 0
  let smallestDifference = Infinity
  samples.forEach((sample, index) => {
    if (!sample.timestamp) return
    const difference = Math.abs(new Date(sample.timestamp).getTime() - targetTime)
    if (difference < smallestDifference) {
      nearest = index
      smallestDifference = difference
    }
  })
  return nearest
}

export function WorkoutDetail({ workout, routeMatches, initialTimestamp }: {
  workout: WorkoutDetailData
  routeMatches: ReadonlyArray<WorkoutRouteMatch>
  initialTimestamp?: string
}) {
  const navigate = useNavigate()
  const [sampleIndex, setSampleIndex] = useState(() => nearestSampleIndex(workout.samples, initialTimestamp))
  const [activeSegment, setActiveSegment] = useState<{ readonly id: string, readonly position?: OverlayPosition } | null>(null)
  const segmentHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sample = workout.samples[sampleIndex]
  const segmentOverlays = [...new Map(routeMatches.map((match) => [match.routeId, match])).values()].map((match, index) => ({
    id: match.routeId,
    routeId: match.routeId,
    name: match.routeName,
    type: match.routeType,
    sport: match.routeSport,
    distanceM: match.routeDistanceM,
    workoutCount: match.routeWorkoutCount,
    traversalCount: match.routeTraversalCount,
    matchScore: match.routeMatchScore,
    points: match.geometry,
    color: segmentColors[index % segmentColors.length]!,
  } satisfies RouteOverlay))
  const isPaceSport = workout.sport.toLowerCase().includes('run') || workout.sport.toLowerCase().includes('walk')
  const speed = sample?.speedMps ?? null
  const speedLabel = speed === null || speed <= 0
    ? '-'
    : isPaceSport ? `${duration(1609.344 / speed)} /mi` : `${(speed * 2.23694).toFixed(1)} mph`

  const changeActiveSegment = (id: string | null, position?: OverlayPosition) => {
    if (segmentHideTimer.current) clearTimeout(segmentHideTimer.current)
    segmentHideTimer.current = null
    if (id) {
      setActiveSegment((current) => ({ id, position: position ?? (current?.id === id ? current.position : undefined) }))
      return
    }
    segmentHideTimer.current = setTimeout(() => setActiveSegment(null), 120)
  }

  useEffect(() => () => {
    if (segmentHideTimer.current) clearTimeout(segmentHideTimer.current)
  }, [])

  return (
    <main>
      <AppNav />
      <header className="workout-detail-header">
        <div><p className="eyebrow">{workout.sport.replaceAll('_', ' ')} / Workout #{workout.sourceActivityId}</p><h1>{new Date(workout.startedAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h1></div>
        <div className="header-actions"><span>{new Date(workout.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span><span>{workout.distanceM === null ? '-' : `${miles(workout.distanceM).toFixed(2)} mi`}</span><span>{duration(workout.durationSeconds)}</span></div>
      </header>

      {sample ? <>
        <section className="workout-playback">
          <div className="playback-map" style={activeSegment?.position ? { '--segment-tooltip-x': `${activeSegment.position.x}%`, '--segment-tooltip-y': `${activeSegment.position.y}%` } as React.CSSProperties : undefined}><RouteThumbnail
            points={workout.samples}
            selectedIndex={sampleIndex}
            viewWidth={1000}
            viewHeight={500}
            overlays={segmentOverlays}
            activeOverlayId={activeSegment?.id}
            onOverlayChange={changeActiveSegment}
            onOverlaySelect={(routeId) => navigate({ to: '/analysis/$routeId', params: { routeId }, search: { type: 'all', sport: 'all', minimumWorkouts: 2, minimumQuality: 65, windowLength: 1, mode: 'representative' } })}
          /></div>
          <div className="playback-readout">
            <p className="eyebrow">Point in time</p>
            <strong>{duration(elapsed(workout, sample))}</strong>
            <span>{sample.timestamp ? new Date(sample.timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : 'Time unavailable'}</span>
            <span>{sample.distanceM === null ? 'Distance unavailable' : `${miles(sample.distanceM).toFixed(2)} miles into workout`}</span>
          </div>
        </section>
        <label className="playback-slider">
          <span>Start</span>
          <input aria-label="Workout position" type="range" min="0" max={Math.max(0, workout.samples.length - 1)} value={sampleIndex} onChange={(event) => setSampleIndex(Number(event.target.value))} />
          <span>Finish</span>
        </label>
        <section className="sample-metrics" aria-label="Metrics at selected point">
          <div><Timer /><span>Elapsed</span><strong>{duration(elapsed(workout, sample))}</strong></div>
          <div><MapPin /><span>Distance</span><strong>{sample.distanceM === null ? '-' : `${miles(sample.distanceM).toFixed(2)} mi`}</strong></div>
          <div><Gauge /><span>{isPaceSport ? 'Pace' : 'Speed'}</span><strong>{speedLabel}</strong></div>
          <div><HeartPulse /><span>Heart rate</span><strong>{sample.heartRateBpm === null ? '-' : `${Math.round(sample.heartRateBpm)} bpm`}</strong></div>
          <div><Mountain /><span>Elevation</span><strong>{sample.altitudeM === null ? '-' : `${Math.round(sample.altitudeM * 3.28084)} ft`}</strong></div>
          <div><span className="metric-symbol">C</span><span>Cadence</span><strong>{sample.cadence === null ? '-' : `${Math.round(sample.cadence)} rpm`}</strong></div>
          <div><span className="metric-symbol">W</span><span>Power</span><strong>{sample.powerW === null ? '-' : `${Math.round(sample.powerW)} W`}</strong></div>
        </section>
      </> : <section className="analysis-empty"><MapPin /><h2>No GPS samples</h2><p>This workout has no recorded route to play back.</p></section>}
      <section className="workout-segments">
        <div className="section-heading"><div><p className="eyebrow">Route analysis</p><h2>Detected segments</h2></div><span>{routeMatches.length} {routeMatches.length === 1 ? 'traversal' : 'traversals'}</span></div>
        {routeMatches.length === 0
          ? <div className="workout-segments-empty"><RouteIcon /><p>No detected segments or loops are linked to this workout.</p></div>
          : <div className="table-scroll"><table><thead><tr><th>Trace</th><th>Segment</th><th>Start</th><th>Distance</th><th>Time</th><th><HeartPulse /> Avg HR</th><th><Gauge /> Avg speed</th><th>Quality</th></tr></thead><tbody>{routeMatches.map((match) => {
            const startOffset = Math.max(0, (new Date(match.startedAt).getTime() - new Date(workout.startedAt).getTime()) / 1000)
            return <tr key={match.traversalId} className={activeSegment?.id === match.routeId ? 'is-active-segment' : undefined} onPointerEnter={() => changeActiveSegment(match.routeId)} onPointerLeave={() => changeActiveSegment(null)}>
              <td className="effort-trace"><RouteThumbnail points={match.geometry} linkAttribution={false} /></td>
              <td><Link className="segment-name-link" to="/analysis/$routeId" params={{ routeId: match.routeId }} search={{ type: 'all', sport: 'all', minimumWorkouts: 2, minimumQuality: 65, windowLength: 1, mode: 'representative' }}><span className={`route-type route-type-${match.routeType}`}>{match.routeType === 'loop' ? <Repeat2 /> : <RouteIcon />}{match.routeType}</span><strong>{match.routeName}</strong></Link></td>
              <td className="numeric"><button className="seek-segment-button" type="button" onClick={() => setSampleIndex(nearestSampleIndex(workout.samples, match.startedAt))}>{duration(startOffset)}</button></td>
              <td className="numeric">{miles(match.distanceM).toFixed(2)} mi</td>
              <td className="numeric">{duration(match.durationSec)}</td>
              <td className="numeric hr">{match.avgHeartRate === null ? '-' : Math.round(match.avgHeartRate)}</td>
              <td className="numeric">{match.avgSpeed === null ? '-' : `${(match.avgSpeed * 2.23694).toFixed(1)} mph`}</td>
              <td><span className="quality">{Math.round(match.qualityScore * 100)}%</span></td>
            </tr>
          })}</tbody></table></div>}
      </section>
    </main>
  )
}
