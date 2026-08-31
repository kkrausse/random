import { createServerFn } from '@tanstack/react-start'

export const getWorkouts = createServerFn({ method: 'GET' }).handler(async () => {
  const { getWorkoutsHandler } = await import('./workouts.server')
  return getWorkoutsHandler()
})

export const getWorkout = createServerFn({ method: 'GET' })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const { getWorkoutHandler } = await import('./workouts.server')
    return getWorkoutHandler(data.id)
  })

export const getWorkoutRouteMatches = createServerFn({ method: 'GET' })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const { getWorkoutRouteMatchesHandler } = await import('./workouts.server')
    return getWorkoutRouteMatchesHandler(data.id)
  })

export const startGarminSync = createServerFn({ method: 'POST' }).handler(async () => {
  const { startGarminSyncHandler } = await import('./workouts.server')
  return startGarminSyncHandler()
})

export const getGarminSyncStatus = createServerFn({ method: 'GET' })
  .validator((input: { jobId: string }) => input)
  .handler(async ({ data }) => {
    const { getGarminSyncStatusHandler } = await import('./workouts.server')
    return getGarminSyncStatusHandler(data.jobId)
  })
