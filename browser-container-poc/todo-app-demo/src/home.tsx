import { useEffect, useState, type FormEvent } from 'react'
import type { Todo } from './todos'

async function request(path = '', method = 'GET', body?: unknown) {
  const response = await fetch(`/api/todos${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) throw new Error((await response.json()).error ?? 'Request failed')
  return response.status === 204 ? undefined : response.json()
}

export default function Home() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')

  async function refresh() {
    setTodos(await request())
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { void run(refresh) }, [])

  function add(event: FormEvent) {
    event.preventDefault()
    void run(async () => {
      await request('', 'POST', { title })
      setTitle('')
      await refresh()
    })
  }

  return (
    <main>
      <h1>Todos</h1>
      <form onSubmit={add}>
        <label htmlFor="title">New todo</label>
        <div className="row">
          <input id="title" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} disabled={busy} />
          <button disabled={busy || !title.trim()}>Add</button>
        </div>
      </form>
      {error && <p role="alert">{error} <button disabled={busy} onClick={() => void run(refresh)}>Retry</button></p>}
      {busy && <p role="status">Loading…</p>}
      {!busy && !error && !todos.length && <p>No todos yet.</p>}
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>
            <label>
              <input type="checkbox" checked={todo.completed} disabled={busy} onChange={() => void run(async () => {
                await request(`/${todo.id}`, 'PATCH', { completed: !todo.completed })
                await refresh()
              })} />
              <span className={todo.completed ? 'completed' : undefined}>{todo.title}</span>
            </label>
            <button disabled={busy} aria-label={`Delete ${todo.title}`} onClick={() => void run(async () => {
              await request(`/${todo.id}`, 'DELETE')
              await refresh()
            })}>Delete</button>
          </li>
        ))}
      </ul>
    </main>
  )
}
