import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter } from '@/server/trpcRouter'
import type { Todo } from '@/schema/todo'
import { createStaticHandler } from '@/server/staticFiles'

const isProduction = process.env.NODE_ENV === 'production'
const useBuild = isProduction || !!process.env.SERVE_BUILD
const todos = new Map<string, Todo>()

const apiRoutes = {
  '/api/*': (req: Request) => fetchRequestHandler({
    endpoint: '/api',
    req,
    router: appRouter,
    createContext: ({ req }) => ({ req, todos }),
  }),
}
const buildRoutes: Record<string, (req: Request) => Promise<Response>> = useBuild
  ? { '/*': createStaticHandler('build/client') }
  : {}

const server = Bun.serve({
  port: useBuild ? Number(process.env.PORT) || 3000 : 3001,
  routes: { ...apiRoutes, ...buildRoutes },
})

console.log(`Server running at ${server.url}`)
