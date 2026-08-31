import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState, useTransition } from 'react'

import { WorkoutTable } from '../components/WorkoutTable'
import { AppNav } from '../components/AppNav'
import { getGarminSyncStatus, getWorkouts, startGarminSync } from '../server/workouts.functions'

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>) => {
    const sortableColumns = new Set(['startedAt', 'sport', 'distanceM', 'durationSeconds', 'speed', 'ascentM', 'avgHrBpm'])
    return {
      sort: typeof search.sort === 'string' && sortableColumns.has(search.sort) ? search.sort : 'startedAt',
      direction: search.direction === 'asc' ? 'asc' as const : 'desc' as const,
    }
  },
  loader: () => getWorkouts(),
  component: Home,
})

function Home() {
  const router = useRouter()
  const activities = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const [isPending, startTransition] = useTransition()
  const [status, setStatus] = useState<string | null>(null)

  const sync = () => {
    setStatus(null)
    startTransition(async () => {
      try {
        const { jobId } = await startGarminSync()
        while (true) {
          const result = await getGarminSyncStatus({ data: { jobId } })
          setStatus(result.message)
          if (result.status === 'failed') throw new Error(result.message)
          if (result.status === 'complete') break
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
        await router.invalidate()
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
      <WorkoutTable activities={activities} sorting={[{ id: search.sort, desc: search.direction === 'desc' }]} onSortingChange={(sorting) => navigate({ search: { sort: sorting[0]?.id ?? 'startedAt', direction: sorting[0]?.desc === false ? 'asc' : 'desc' } })} />
    </main>
  )
}
