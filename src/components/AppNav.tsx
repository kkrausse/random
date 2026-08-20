import { Link } from '@tanstack/react-router'

export function AppNav() {
  return (
    <nav className="app-nav" aria-label="Primary navigation">
      <Link to="/" activeOptions={{ exact: true }} activeProps={{ 'aria-current': 'page' }}>Workouts</Link>
      <Link to="/analysis" activeOptions={{ exact: false }} activeProps={{ 'aria-current': 'page' }}>Segment analysis</Link>
    </nav>
  )
}
