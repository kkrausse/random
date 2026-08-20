import { createFileRoute, notFound } from '@tanstack/react-router'

import { RouteDetail } from '../components/RouteDetail'
import { getDetectedRoute } from '../server/analysis.functions'

export const Route = createFileRoute('/analysis/$routeId')({
  loader: async ({ params }) => {
    const route = await getDetectedRoute({ data: { id: params.routeId } })
    if (!route) throw notFound()
    return route
  },
  component: DetailPage,
})

function DetailPage() {
  return <RouteDetail route={Route.useLoaderData()} />
}
