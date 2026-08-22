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

export const syncGarmin = createServerFn({ method: 'POST' }).handler(async () => {
  const { syncGarminHandler } = await import('./workouts.server')
  return syncGarminHandler()
})
