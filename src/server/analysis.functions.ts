import { createServerFn } from '@tanstack/react-start'

export const getDetectedRoutes = createServerFn({ method: 'GET' }).handler(async () => {
  const { getRoutesHandler } = await import('./analysis.server')
  return getRoutesHandler()
})

export const getDetectedRoute = createServerFn({ method: 'GET' })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const { getRouteHandler } = await import('./analysis.server')
    return getRouteHandler(data.id)
  })
