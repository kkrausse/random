import type { Activity } from '../domain/activity'
import { RouteThumbnail } from './RouteThumbnail'

const miles = (meters: number) => meters / 1609.344

const duration = (seconds: number | null) => {
  if (seconds === null) return '—'
  const rounded = Math.round(seconds)
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const remaining = rounded % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${minutes}:${String(remaining).padStart(2, '0')}`
}

const speedOrPace = (activity: Activity) => {
  if (!activity.distanceM || !activity.durationSeconds) return '—'
  const distanceMiles = miles(activity.distanceM)
  if (activity.sport.toLowerCase().includes('run') || activity.sport.toLowerCase().includes('walk')) {
    const paceSeconds = activity.durationSeconds / distanceMiles
    return `${Math.floor(paceSeconds / 60)}:${String(Math.round(paceSeconds % 60)).padStart(2, '0')} /mi`
  }
  return `${(distanceMiles / (activity.durationSeconds / 3600)).toFixed(1)} mph`
}

export function WorkoutTable({ activities }: { activities: ReadonlyArray<Activity> }) {
  if (activities.length === 0) {
    return (
      <div className="empty-state">
        <p>No indexed workouts yet.</p>
        <code>bun run garmin:login</code>
        <code>bun run garmin:sync</code>
        <code>bun run build:data</code>
      </div>
    )
  }

  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>Route</th><th>Date</th><th>Type</th><th>Distance</th><th>Time</th><th>Speed / pace</th><th>Climb</th><th>Avg HR</th></tr></thead>
        <tbody>
          {activities.map((activity) => (
            <tr key={activity.id}>
              <td><RouteThumbnail points={activity.route} /></td>
              <td className="date-cell"><strong>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(activity.startedAt))}</strong><span>{new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(activity.startedAt))}</span></td>
              <td><span className={`sport sport-${activity.sport.toLowerCase()}`}>{activity.sport.replaceAll('_', ' ')}</span></td>
              <td className="numeric">{activity.distanceM === null ? '—' : `${miles(activity.distanceM).toFixed(1)} mi`}</td>
              <td className="numeric">{duration(activity.durationSeconds)}</td>
              <td className="numeric">{speedOrPace(activity)}</td>
              <td className="numeric">{activity.ascentM === null ? '—' : `${Math.round(activity.ascentM * 3.28084).toLocaleString()} ft`}</td>
              <td className="numeric hr">{activity.avgHrBpm === null ? '—' : Math.round(activity.avgHrBpm)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
