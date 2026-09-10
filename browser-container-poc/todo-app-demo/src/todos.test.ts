import { describe, expect, test } from 'bun:test'
import { createTodoApi } from './todos'

function client() {
  const handle = createTodoApi()
  return (path = '', method = 'GET', body?: unknown) => handle(new Request(`http://localhost/api/todos${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
}

describe('todo API', () => {
  test('creates, lists, reads, updates and deletes a todo', async () => {
    const call = client()
    expect(await (await call()).json()).toEqual([])
    const created = await call('', 'POST', { title: ' Buy milk ' })
    expect(created.status).toBe(201)
    const todo = await created.json()
    expect(todo).toEqual({ id: expect.any(String), title: 'Buy milk', completed: false })
    expect(await (await call()).json()).toEqual([todo])
    expect(await (await call(`/${todo.id}`)).json()).toEqual(todo)
    expect(await (await call(`/${todo.id}`, 'PATCH', { completed: true })).json()).toEqual({ ...todo, completed: true })
    expect(await (await call(`/${todo.id}`, 'PATCH', { title: ' Bread ' })).json()).toEqual({ ...todo, title: 'Bread', completed: true })
    expect((await call(`/${todo.id}`, 'DELETE')).status).toBe(204)
    expect(await (await call()).json()).toEqual([])
    expect((await call(`/${todo.id}`)).status).toBe(404)
    expect((await call(`/${todo.id}`, 'PATCH', { completed: false })).status).toBe(404)
  })

  test('rejects bad input without changing stored data', async () => {
    const call = client()
    for (const body of [null, [], {}, { title: '' }, { title: '  ' }, { title: 'x'.repeat(201) }, { title: 1 }, { title: 'ok', completed: 'yes' }, { title: 'ok', id: 'custom' }]) {
      expect((await call('', 'POST', body)).status).toBe(400)
    }
    const todo = await (await call('', 'POST', { title: 'Keep' })).json()
    for (const body of [{}, { title: '' }, { completed: 1 }, { unknown: true }]) {
      expect((await call(`/${todo.id}`, 'PATCH', body)).status).toBe(400)
    }
    expect(await (await call()).json()).toEqual([todo])
    const handle = createTodoApi()
    expect((await handle(new Request('http://localhost/api/todos', { method: 'POST', body: '{' }))).status).toBe(400)
  })

  test('isolates stores and reports unsupported methods and paths', async () => {
    const call = client()
    await call('', 'POST', { title: 'One' })
    expect(await (await client()()).json()).toEqual([])
    const response = await call('', 'DELETE')
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('GET, POST')
    expect((await call('/missing', 'DELETE')).status).toBe(404)
    expect((await call('/too/many/segments')).status).toBe(404)
  })
})
