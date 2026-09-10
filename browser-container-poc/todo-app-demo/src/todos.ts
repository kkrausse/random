export type Todo = { id: string; title: string; completed: boolean }

export function createTodoApi(): (request: Request) => Promise<Response> {
  const todos = new Map<string, Todo>()
  const error = (message: string, status: number) => Response.json({ error: message }, { status })

  return async (request) => {
    const path = new URL(request.url).pathname
    const collection = path === '/api/todos'
    const id = /^\/api\/todos\/([^/]+)$/.exec(path)?.[1]
    if (!collection && !id) return error('Not found', 404)
    const todo = id ? todos.get(id) : undefined
    if (id && !todo) return error('Todo not found', 404)

    if (request.method === 'GET') return Response.json(collection ? [...todos.values()] : todo)
    if (request.method === 'DELETE' && id) {
      todos.delete(id)
      return new Response(null, { status: 204 })
    }
    if (!((request.method === 'POST' && collection) || (request.method === 'PATCH' && todo))) {
      return new Response(null, { status: 405, headers: { Allow: collection ? 'GET, POST' : 'GET, PATCH, DELETE' } })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return error('Expected JSON', 400)
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return error('Expected an object', 400)
    const input = body as Record<string, unknown>
    if (Object.keys(input).some((key) => !['title', 'completed'].includes(key))) return error('Unknown field', 400)
    if ((!todo || 'title' in input) && (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 200)) {
      return error('Title must contain 1–200 characters', 400)
    }
    if ('completed' in input && typeof input.completed !== 'boolean') return error('Completed must be a boolean', 400)
    if (todo && !Object.keys(input).length) return error('Provide title or completed', 400)

    const updated: Todo = {
      id: todo?.id ?? crypto.randomUUID(),
      title: typeof input.title === 'string' ? input.title.trim() : todo!.title,
      completed: typeof input.completed === 'boolean' ? input.completed : (todo?.completed ?? false),
    }
    todos.set(updated.id, updated)
    return Response.json(updated, { status: todo ? 200 : 201 })
  }
}
