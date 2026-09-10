import { resolve, sep } from 'node:path'
import { createRequestHandler } from 'react-router'
import { createTodoApi } from './src/todos'

const production = process.env.NODE_ENV === 'production'
const clientDirectory = resolve(import.meta.dir, 'build/client')
const buildPath = resolve(import.meta.dir, 'build/server/index.js')
const render = production ? createRequestHandler(() => import(buildPath), 'production') : undefined

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT ?? (production ? 3000 : 3001)),
  routes: { '/api/*': createTodoApi() },
  async fetch(request) {
    const pathname = new URL(request.url).pathname
    if (render && pathname.startsWith('/assets/')) {
      const path = resolve(clientDirectory, `.${decodeURIComponent(pathname)}`)
      if (!path.startsWith(clientDirectory + sep)) return new Response('Not found', { status: 404 })
      const file = Bun.file(path)
      return await file.exists()
        ? new Response(file, { headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } })
        : new Response('Not found', { status: 404 })
    }
    return render ? render(request) : new Response('Not found', { status: 404 })
  },
})

console.log(`Todo server: ${server.url}`)
