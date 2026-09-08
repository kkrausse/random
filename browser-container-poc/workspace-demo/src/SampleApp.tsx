import React, { useEffect, useState } from "react";

/** This exact source is compiled into the deployed app and seeded into guest Vite. */
export default function SampleApp() {
  const [count, setCount] = useState(0);
  const [saved, setSaved] = useState<number>();
  const [note, setNote] = useState("");
  const refresh = async () => {
    const response = await fetch("/api/counter");
    if (!response.ok) throw Error(`Backend HTTP ${response.status}`);
    setSaved((await response.json()).count);
  };
  useEffect(() => { void refresh().catch(error => setNote(String(error))); }, []);
  return <main style={{ fontFamily: "system-ui", padding: "1rem" }}>
    <h1>My browser counter</h1>
    <p>The same app runs normally and in editing mode. Backend state belongs to this server.</p>
    <button onClick={() => setCount(value => value + 1)}>Count: {count}</button>{" "}
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
    <p role="status">{note}</p>
  </main>;
}
