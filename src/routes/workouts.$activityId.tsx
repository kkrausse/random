import { createFileRoute, notFound } from '@tanstack/react-router'

import { WorkoutDetail } from '../components/WorkoutDetail'
import { getWorkout } from '../server/workouts.functions'

export const Route = createFileRoute('/workouts/$activityId')({
  validateSearch: (search: Record<string, unknown>) => ({
    at: typeof search.at === 'string' ? search.at : undefined,
  }),
  loader: async ({ params }) => {
    const workout = await getWorkout({ data: { id: params.activityId } })
    if (!workout) throw notFound()
    return workout
  },
  component: WorkoutPage,
})

function WorkoutPage() {
  const { at } = Route.useSearch()
  return <WorkoutDetail workout={Route.useLoaderData()} initialTimestamp={at} />
}
