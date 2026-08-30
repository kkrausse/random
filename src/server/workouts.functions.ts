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

export const syncGarmin = createServerFn({ method: 'POST' }).handler(async () => {
  const [{ syncGarminHandler }, { Effect }] = await Promise.all([
    import('./workouts.server'),
    import('effect'),
  ])
  return Effect.runPromise(syncGarminHandler())
})
