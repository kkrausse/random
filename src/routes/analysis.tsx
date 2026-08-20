import { Outlet, createFileRoute } from '@tanstack/react-router'

import { AppNav } from '../components/AppNav'

export const Route = createFileRoute('/analysis')({ component: AnalysisLayout })

function AnalysisLayout() {
  return <main><AppNav /><Outlet /></main>
}
