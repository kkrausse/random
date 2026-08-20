import { createFileRoute } from '@tanstack/react-router'
import { useState, useTransition } from 'react'

import { WorkoutTable } from '../components/WorkoutTable'
import { AppNav } from '../components/AppNav'
import { getWorkouts, syncGarmin } from '../server/workouts.functions'

export const Route = createFileRoute('/')({
  loader: () => getWorkouts(),
  component: Home,
})

function Home() {
  const activities = Route.useLoaderData()
  const [isPending, startTransition] = useTransition()
  const [status, setStatus] = useState<string | null>(null)

  const sync = () => {
    setStatus(null)
    startTransition(async () => {
      try {
        const result = await syncGarmin()
        setStatus(result.message)
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Garmin sync failed')
      }
    })
  }

  return (
    <main>
      <AppNav />
      <header>
        <div><p className="eyebrow">Personal archive</p><h1>Workout Ledger</h1></div>
        <div className="header-actions"><span>{activities.length} activities</span><button className="sync-button" type="button" onClick={sync} disabled={isPending}>{isPending ? 'Syncing…' : 'Sync Garmin'}</button></div>
      </header>
      {status && <p className="sync-status" role="status">{status}</p>}
      <WorkoutTable activities={activities} />
    </main>
  )
}
