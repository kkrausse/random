import React, { useEffect, useState } from "react";

/** This exact source is compiled into the deployed app and seeded into guest Vite. */
export default function SampleApp({ editorControl }: { editorControl?: React.ReactNode } = {}) {
  const [count, setCount] = useState(0);
  const [tasks, setTasks] = useState([
    { title: "Try the counter and save it to the backend", done: false },
    { title: "Open local editor mode", done: false },
    { title: "Ask the agent to change this page", done: false },
  ]);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState<number>();
  const [note, setNote] = useState("");
  const refresh = async () => {
    const response = await fetch("/api/counter");
    if (!response.ok) throw Error(`Backend HTTP ${response.status}`);
    setSaved((await response.json()).count);
  };
  useEffect(() => { void refresh().catch(error => setNote(String(error))); }, []);
  return <main className="sample-app">
    <style>{`
      .sample-app { font-family: system-ui, sans-serif; color: #172033; background: #f8fafc; min-height: 100vh; padding: clamp(20px, 5vw, 64px); line-height: 1.6; }
      .sample-app * { box-sizing: border-box; }
      .sample-app .sample-content { max-width: 1040px; margin: auto; }
      .sample-app h1 { font-size: clamp(30px, 5vw, 46px); font-weight: 700; line-height: 1.15; margin: 12px 0; }
      .sample-app h2 { font-size: 20px; font-weight: 650; margin: 0 0 12px; }
      .sample-app p { margin: 12px 0; }
      .sample-app .sample-label { font-size: 13px; font-weight: 650; color: #475569; }
      .sample-app .sample-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 20px; margin: 28px 0; }
      .sample-app section { background: white; border: 1px solid #dbe1e8; border-radius: 10px; padding: 24px; }
      .sample-app button, .sample-app input[type=text] { font: inherit; border: 1px solid #cbd5e1; border-radius: 6px; padding: 7px 12px; background: white; color: inherit; }
      .sample-app button { cursor: pointer; margin: 4px 4px 4px 0; }
      .sample-app button:hover { background: #eef2f6; }
      .sample-app button:disabled { opacity: .6; cursor: wait; }
      .sample-app #start-sample { background: #172033; color: white; padding: 10px 18px; }
      .sample-app label { display: flex; gap: 10px; align-items: baseline; padding: 8px 0; }
      .sample-app input[type=checkbox] { accent-color: #172033; }
      .sample-app form { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 16px; }
      .sample-app input[type=text] { flex: 1; min-width: 120px; }
      .sample-app ul, .sample-app ol { padding-left: 22px; list-style: revert; }
      .sample-app li { margin: 8px 0; }
      .sample-app .sample-status { min-height: 26px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; }
    `}</style>
    <div className="sample-content">
    <header>
      <span className="sample-label">KEV-BROWSER-AGENT-KIT · EDITABLE APP DEMO</span>
      <h1>A little app you can make your own.</h1>
      <p>Try the dashboard below, then edit its source right in your browser. An agent can change the actual React files while Vite updates the live preview.</p>
      {editorControl ?? <p className="sample-label">Use the workspace controls to chat, edit source, or exit editing mode.</p>}
    </header>
    <div className="sample-grid">
    <section aria-labelledby="counter-heading">
    <h2 id="counter-heading">Counter & backend</h2>
    <p>Increment locally, then save through the same API used by the normal app.</p>
    <button onClick={() => setCount(value => value + 1)}>Count: {count}</button>{" "}
    <button onClick={() => setCount(0)}>Reset counter</button>{" "}
    <button onClick={() => void (async () => {
      const response = await fetch("/api/counter", { method: "POST", headers: { "content-type": "application/json", "x-counter-client": "shared-app" }, body: JSON.stringify({ count }) });
      if (!response.ok) throw Error(`Backend HTTP ${response.status}`);
      await refresh(); setNote("Saved to same-origin backend");
    })().catch(error => setNote(String(error)))}>Save to backend</button>{" "}
    <button onClick={() => void refresh().catch(error => setNote(String(error)))}>Refresh backend</button>
    <p>Backend count: {saved ?? "Loading…"}</p>
    <button onClick={() => void (async () => {
      const response = await fetch("/api/stream");
      if (!response.ok || !response.body) throw Error(`Stream HTTP ${response.status}`);
      setNote("");
      const reader = response.body.getReader(), decoder = new TextDecoder();
      while (true) { const chunk = await reader.read(); if (chunk.done) break; const text = decoder.decode(chunk.value, { stream: true }); setNote(value => value + text); }
    })().catch(error => setNote(String(error)))}>Read backend stream</button>
    <p className="sample-status" role="status">{note}</p>
    <p className="sample-label">Backend data lasts until the host server restarts. The local counter belongs to this React view.</p>
    </section>
    <section aria-labelledby="checklist-heading">
      <h2 id="checklist-heading">Your demo checklist</h2>
      <p>{tasks.filter(task => task.done).length} of {tasks.length} complete · local view state</p>
      {tasks.map((task, index) => <label key={index}>
        <input type="checkbox" checked={task.done} onChange={() => setTasks(values => values.map((value, i) => i === index ? { ...value, done: !value.done } : value))} />
        <span style={{ textDecoration: task.done ? "line-through" : undefined }}>{task.title}</span>
      </label>)}
      <form onSubmit={event => { event.preventDefault(); if (!draft.trim()) return; setTasks(values => [...values, { title: draft.trim(), done: false }]); setDraft(""); }}>
        <input type="text" aria-label="New checklist item" placeholder="Something else to try…" value={draft} onChange={event => setDraft(event.target.value)} />
        <button type="submit">Add item</button>
      </form>
    </section>
    </div>
    <div className="sample-grid">
    <section>
      <h2>Make your first edit</h2>
      <ol>
        <li>Click <strong>Local editor mode</strong> and wait for the workspace to start.</li>
        <li>Open chat, select a model, and click <strong>New chat</strong>.</li>
        <li>Ask for a change below—or open the source editor and save a change yourself.</li>
      </ol>
      <p>Source edits persist in this browser. <strong>Reset source</strong> restores the sample; <strong>Exit</strong> returns to the normal app.</p>
    </section>
    <section>
      <h2>Things to ask the agent</h2>
      <ul>
        <li>“Add a decrement button next to the counter.”</li>
        <li>“Show a progress bar above the checklist.”</li>
        <li>“Add a button to clear completed checklist items.”</li>
        <li>“Change the heading and give the page a green accent.”</li>
      </ul>
      <p className="sample-label">The agent edits /workspace/src/App.tsx. Vite and OpenCode execute inside browser workers; API requests still reach the host backend.</p>
    </section>
    </div>
    </div>
  </main>;
}
