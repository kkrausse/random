import React, { useEffect, useState } from "react";

type Todo = { id: string; title: string; completed: boolean };

/** This exact source is compiled into the deployed app and seeded into guest Vite. */
export default function SampleApp({ editorControl }: { editorControl?: React.ReactNode } = {}) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch(path, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw Error(detail?.error ?? `Backend HTTP ${response.status}`);
    }
    return response.status === 204 ? undefined : response.json();
  };
  const refresh = async () => { setTodos((await request("/api/todos")).todos); };
  useEffect(() => {
    let active = true;
    void request("/api/todos").then(data => { if (active) setTodos(data.todos); }).catch(reason => { if (active) setError(String(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await action(); } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };
  return <main className="sample-app">
    <style>{`
      body { margin: 0; }
      .sample-app { font: 16px/1.5 system-ui, sans-serif; max-width: 640px; margin: auto; padding: 24px; color: #172033; }
      .sample-app h1 { font-size: 30px; font-weight: 700; margin: 16px 0; }
      .sample-app button, .sample-app input[type=text] { font: inherit; color: inherit; background: white; border: 1px solid #cbd5e1; border-radius: 4px; padding: 6px 10px; }
      .sample-app button { cursor: pointer; }
      .sample-app button:disabled { opacity: .5; cursor: default; }
      .sample-app form, .sample-app li, .sample-app label { display: flex; align-items: center; gap: 10px; }
      .sample-app form { margin: 20px 0; }
      .sample-app input[type=text], .sample-app label { flex: 1; min-width: 0; }
      .sample-app ul { list-style: none; padding: 0; }
      .sample-app li { padding: 12px 0; border-bottom: 1px solid #e2e8f0; }
      .sample-app label span { overflow-wrap: anywhere; }
      .sample-app .sample-label { font-size: 13px; color: #475569; }
      .sample-app [role=alert] { color: #b91c1c; }
    `}</style>
    <header><h1>Todos</h1><p>A simple shared list. Add a task, check it off, or remove it.</p>{editorControl}</header>
    <form onSubmit={event => { event.preventDefault(); if (!draft.trim() || busy || loading) return; void run(async () => {
      const { todo } = await request("/api/todos", "POST", { title: draft });
      setTodos(values => [...values, todo]); setDraft("");
    }); }}>
      <input type="text" aria-label="New todo" placeholder="What needs doing?" maxLength={200} value={draft} disabled={busy || loading} onChange={event => setDraft(event.target.value)} />
      <button type="submit" disabled={busy || loading || !draft.trim()}>Add task</button>
    </form>
    {error && <p role="alert">{error}</p>}
    <p role="status">{loading ? "Loading tasks…" : `${todos.filter(todo => todo.completed).length} of ${todos.length} complete`}</p>
    {!loading && !todos.length && <p>No tasks yet. Add your first task above.</p>}
    <ul aria-label="Todo list">{todos.map(todo => <li key={todo.id}>
      <label><input type="checkbox" checked={todo.completed} disabled={busy} onChange={() => void run(async () => {
        const data = await request(`/api/todos/${todo.id}`, "PATCH", { completed: !todo.completed });
        setTodos(values => values.map(value => value.id === todo.id ? data.todo : value));
      })} /><span style={{ textDecoration: todo.completed ? "line-through" : undefined }}>{todo.title}</span></label>
      <button disabled={busy} aria-label={`Delete ${todo.title}`} onClick={() => void run(async () => {
        await request(`/api/todos/${todo.id}`, "DELETE"); setTodos(values => values.filter(value => value.id !== todo.id));
      })}>Delete</button>
    </li>)}</ul>
    <button disabled={busy || loading} onClick={() => void run(refresh)}>Refresh tasks</button>
    <p className="sample-label">Tasks are saved on the app server and shared with the editor preview. They last until the server restarts.</p>
  </main>;
}
