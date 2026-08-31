import { createFileRoute, notFound } from '@tanstack/react-router'

import { WorkoutDetail } from '../components/WorkoutDetail'
import { getWorkout, getWorkoutRouteMatches } from '../server/workouts.functions'

export const Route = createFileRoute('/workouts/$activityId')({
  validateSearch: (search: Record<string, unknown>) => ({
    at: typeof search.at === 'string' ? search.at : undefined,
  }),
  loader: async ({ params }) => {
    const [workout, routeMatches] = await Promise.all([
      getWorkout({ data: { id: params.activityId } }),
      getWorkoutRouteMatches({ data: { id: params.activityId } }),
    ])
    if (!workout) throw notFound()
    return { workout, routeMatches }
  },
  component: WorkoutPage,
})

function WorkoutPage() {
  const { at } = Route.useSearch()
  const { workout, routeMatches } = Route.useLoaderData()
  return <WorkoutDetail workout={workout} routeMatches={routeMatches} initialTimestamp={at} />
}
