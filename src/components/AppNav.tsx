import { Link } from '@tanstack/react-router'

export function AppNav() {
  return (
    <nav className="app-nav" aria-label="Primary navigation">
      <Link to="/" search={{ sort: 'startedAt', direction: 'desc' }} activeOptions={{ exact: true }} activeProps={{ 'aria-current': 'page' }}>Workouts</Link>
      <Link to="/analysis" search={{ type: 'all', sport: 'all', minimumWorkouts: 2 }} activeOptions={{ exact: false }} activeProps={{ 'aria-current': 'page' }}>Segment analysis</Link>
    </nav>
  )
}
