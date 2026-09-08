import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Play, RotateCcw, Save, Square, LoaderCircle } from "lucide-react";
import { attachPreview, type Workspace } from "@vivari/workspace-api";
import { WorkspaceProvider, useWorkspace } from "./workspace-provider";
import { createSampleRecipe, sourcePaths } from "./sample-recipe";
import { mountChat } from "./chat-adapter";
import { openFixture } from "./fixture";
import { Button } from "./components/ui/button";
import { diagnostics } from "./diagnostics";

const decoder = new TextDecoder();
function FileEditor({ dirty, setDirty }: { dirty: boolean; setDirty(value: boolean): void }) {
  const { controller, state } = useWorkspace();
  const [paths, setPaths] = useState<string[]>([]);
  const [path, setPath] = useState("/src/App.tsx");
  const [contents, setContents] = useState("");
  const [note, setNote] = useState("Save writes and flushes the guest file. Vite updates the preview through HMR.");
  useEffect(() => {
    let active = true;
    if (!state.workspace) { setPaths([]); setContents(""); return; }
    if (state.busy || dirty) return;
    void sourcePaths(state.workspace).then(async files => {
      const selected = files.includes(path) ? path : files.includes("/src/App.tsx") ? "/src/App.tsx" : files[0];
      const bytes = selected ? await state.workspace!.fs.readFile(selected) : undefined;
      if (!active) return;
      setPaths(files); if (selected) setPath(selected); if (bytes) setContents(decoder.decode(bytes));
    }).catch(error => { if (active) setNote(String(error)); });
    return () => { active = false; };
  }, [state.workspace, state.busy, dirty]);
  const read = (selected = path) => controller.run("Read file", async () => {
    if (dirty) throw Error("Save current editor changes before reading another file");
    setContents(decoder.decode(await controller.workspace!.fs.readFile(selected))); setPath(selected); setNote(`Read ${selected}`);
  });
  return <section className="min-w-0 space-y-3" aria-labelledby="editor-heading">
    <h2 id="editor-heading">Guest source editor</h2>
    <label className="block">Files <select aria-label="Files" className="max-w-full" disabled={state.busy || !state.workspace || dirty} value={path} onChange={event => void read(event.target.value)}>
      {!paths.length && <option value="/src/App.tsx">No workspace open</option>}{paths.map(file => <option key={file}>{file}</option>)}
    </select></label>
    <label className="block">Path <input aria-label="Path" value={path} disabled={state.busy || !state.workspace} onChange={event => setPath(event.target.value)} /></label>
    <textarea aria-label="File contents" className="w-full h-80 font-mono" spellCheck={false} value={contents} disabled={state.busy || !state.workspace} onChange={event => { setContents(event.target.value); setDirty(true); setNote("Unsaved changes — Save file before switching files or restarting."); }} />
    <div className="flex gap-2"><Button disabled={state.busy || !state.workspace} onClick={() => void controller.run("Save file", async () => {
      await controller.workspace!.fs.writeFile(path, contents); await controller.workspace!.flush(); setDirty(false); setNote(`Saved and flushed ${path}`); controller.status(`Saved ${path}`);
    })}><Save />Save file</Button><Button disabled={state.busy || !state.workspace || dirty} onClick={() => void read()}><RotateCcw />Read file</Button></div>
    <p className="text-sm text-neutral-600">{note} Read file picks up OpenCode edits.</p>
  </section>;
}
function Preview() {
  const { controller, state } = useWorkspace();
  const frame = useRef<HTMLIFrameElement>(null);
  const service = state.services.vite;
  useEffect(() => {
    if (!service || !frame.current) return;
    const target = frame.current;
    const loaded = () => {
      try { if (target.contentWindow?.location.href !== "about:blank") controller.clientReady("vite"); }
      catch (error) { controller.clientFailed("vite", error); }
    };
    target.addEventListener("load", loaded);
    try {
      const attachment = attachPreview(target, service.endpoint);
      return controller.registerAttachment("vite", () => { target.removeEventListener("load", loaded); attachment.dispose(); target.src = "about:blank"; });
    } catch (error) { target.removeEventListener("load", loaded); controller.clientFailed("vite", error); }
  }, [controller, service]);
  return <section className="min-w-0 space-y-3" aria-labelledby="preview-heading">
    <h2 id="preview-heading">Guest Vite preview</h2>
    <p className="text-sm text-neutral-600">{service ? `Real guest Vite · ${state.clients.vite}` : "Start workspace to render the separate guest React app here."}</p>
    <iframe id="preview" ref={frame} title="Workspace preview" className="w-full h-96 border border-neutral-300 rounded-md" />
  </section>;
}
function Chat() {
  const { controller, state } = useWorkspace();
  const container = useRef<HTMLDivElement>(null);
  const service = state.services.chat;
  useEffect(() => {
    if (!service || !container.current) return;
    let active = true, dispose: (() => void) | undefined;
    void mountChat(container.current, { endpoint: service.connection, mock: false, directory: "/workspace", autoCreateSession: true }).then(mount => {
      if (!active) { mount.dispose(); return; }
      dispose = controller.registerAttachment("chat", () => { active = false; mount.dispose(); });
      void mount.ready.then(() => { if (active) controller.clientReady("chat"); }).catch(error => { if (active) controller.clientFailed("chat", error); });
    }).catch(error => { if (active) controller.clientFailed("chat", error); });
    return () => { active = false; dispose?.(); };
  }, [controller, service]);
  return <section className="space-y-3" aria-labelledby="chat-heading">
    <h2 id="chat-heading">OpenCode chat</h2>
    <p className="text-sm text-neutral-600">{service ? `Guest OpenCode · ${state.clients.chat}. New workspaces default to Muse Spark (free).` : "Start workspace to connect real guest OpenCode."} Try: “Add a Reset button to /workspace/src/App.tsx.” It edits the same guest source Vite serves.</p>
    <div id="chat" ref={container} />
  </section>;
}
function Search() {
  const { controller, state } = useWorkspace();
  const [query, setQuery] = useState("TODO"), [results, setResults] = useState("");
  return <details className="space-y-2"><summary>Search guest source files</summary>
    <label>Literal text <input value={query} onChange={event => setQuery(event.target.value)} /></label> <Button disabled={state.busy || !state.workspace || !query} onClick={() => void controller.run("Search source", async () => {
      const matches: string[] = [];
      for (const path of await sourcePaths(controller.workspace!)) {
        const bytes = await controller.workspace!.fs.readFile(path);
        if (bytes.length > 1024 * 1024 || bytes.includes(0)) continue;
        decoder.decode(bytes).split("\n").forEach((line, index) => { if (matches.length < 100 && line.includes(query)) matches.push(`${path}:${index + 1}: ${line}`); });
        if (matches.length === 100) break;
      }
      setResults(matches.join("\n") || "No matches");
    })}>Search files</Button><p className="text-sm">Host-side literal scan, capped at 100 matches; not runtime ripgrep.</p><pre className="whitespace-pre-wrap">{results}</pre>
  </details>;
}
function FixturePanel() {
  const [workspace, setWorkspace] = useState<Workspace>(), [contents, setContents] = useState(""), [note, setNote] = useState("");
  useEffect(() => () => { void workspace?.close(); }, [workspace]);
  const run = (task: () => Promise<void>) => { void task().catch(error => setNote(String(error))); };
  return <details className="space-y-2"><summary>Fixture / placeholder (opt-in)</summary>
    <p>This independent fixture uses memory and explicit localStorage snapshots. No runtime, Vite, HMR or model calls.</p>
    <Button disabled={!!workspace} onClick={() => run(async () => { const value = openFixture(); setWorkspace(value); setContents(decoder.decode(await value.fs.readFile("/index.html"))); })}>Open fixture</Button>
    <textarea className="block w-full" aria-label="Fixture HTML" disabled={!workspace} value={contents} onChange={event => setContents(event.target.value)} />
    <Button disabled={!workspace} onClick={() => run(async () => { await workspace!.fs.writeFile("/index.html", contents); await workspace!.flush(); setNote("Fixture snapshot saved to localStorage"); })}>Save fixture snapshot</Button>
    <Button disabled={!workspace} onClick={() => run(async () => { await workspace!.close(); setWorkspace(undefined); })}>Close fixture</Button>
    {workspace && <iframe title="Static fixture preview" sandbox="allow-scripts" srcDoc={contents} />}<p>{note}</p>
  </details>;
}
function App() {
  const { controller, state } = useWorkspace();
  const [recipe] = useState(createSampleRecipe);
  const [dirty, setDirty] = useState(false);
  const ready = state.clients.vite === "ready" && state.clients.chat === "ready";
  const start = () => controller.run("Start workspace", async () => {
    if (dirty) throw Error("Save the editor changes before starting the workspace");
    await recipe.start(controller);
  });
  return <main className="max-w-7xl mx-auto p-4 space-y-6">
    <header className="space-y-3"><h1>Workspace React demo</h1>
      <p>This outer React app consumes the workspace library through a context provider. The editor, live preview and chat share one browser workspace. The counter inside the preview is a separate guest React app running in Vite.</p>
      <Button id="start-sample" variant="default" disabled={state.busy || ready} onClick={() => void start()}>{state.busy ? <LoaderCircle className="animate-spin" /> : <Play />}{state.busy ? "Starting / working…" : ready ? "Workspace running" : state.error ? "Retry Start workspace" : "Start workspace"}</Button>
      <p className="text-sm text-neutral-600">First start seeds a counter into an empty workspace. Later starts preserve your guest files and chat sessions. Keep this tab visible during startup.</p>
      <p id="status" role="status">{state.status}</p>
      <p className="text-sm">Diagnostic run: <code>{diagnostics.run}</code> · <a href="/diagnostics" download>Download local diagnostics</a> · <code>workspace-demo/.diagnostics/events.jsonl</code></p>
      {state.error && <p role="alert" className="border border-red-300 bg-red-50 p-3 whitespace-pre-wrap">{state.error}</p>}
      {!!state.progress.length && <ol aria-label="Startup progress" className="list-decimal pl-6 text-sm space-y-1">{state.progress.map(step => <li key={step.label}>{step.label} — {step.state}</li>)}</ol>}
      <p id="lifecycle" className="text-sm">Workspace: {state.workspace ? `open · ${state.persistence}` : "closed"} | Runtime: {state.runtime ? "active" : "stopped"}</p>
    </header>
    <div className="grid md:grid-cols-2 gap-6"><FileEditor dirty={dirty} setDirty={setDirty} /><Preview /></div>
    <Chat />
    <details className="space-y-3"><summary>Advanced — lifecycle, configuration and fixture</summary>
      <p className="text-sm">Stop keeps files editable. Close flushes files and releases storage. Start workspace restores dependencies and reconnects the guest apps. One open workspace per origin.</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={state.busy || !state.runtime} onClick={() => void controller.run("Stop runtime", () => controller.stopRuntime())}><Square />Stop runtime</Button>
        <Button disabled={state.busy || !state.workspace} onClick={() => void controller.run("Flush workspace", async () => { await controller.workspace!.flush(); controller.status("Workspace flush acknowledged"); })}>Flush workspace</Button>
        <Button disabled={state.busy || !state.workspace || dirty} onClick={() => void controller.run("Close workspace", () => controller.close())}>Close workspace</Button>
        <Button disabled={state.busy || !!state.workspace} onClick={() => void controller.run("Open files only", () => recipe.open(controller))}>Open files only</Button>
        <Button disabled={state.busy || !state.workspace || !!state.runtime} onClick={() => void controller.run("Start runtime only", () => recipe.runtime(controller))}>Start runtime only</Button>
        <Button disabled={state.busy || !state.runtime || !!state.services.vite || !!state.services.chat} onClick={() => void controller.run("Deliver prepared apps", () => recipe.deliver(controller))}>Deliver prepared apps</Button>
        <Button disabled={state.busy || !state.services.vite} onClick={() => void controller.run("Stop preview", () => controller.stopService("vite"))}>Stop preview</Button>
        <Button disabled={state.busy || !state.services.chat} onClick={() => void controller.run("Stop chat", () => controller.stopService("chat"))}>Stop chat</Button>
      </div>
      <p className="text-sm">Configuration is application code: <code>src/sample-recipe.ts</code> selects public API operations; <code>prepare.ts</code> pins guest launch options and missing-file seeds. <code>RUNTIME_DIR</code>, <code>PREPARED_DIR</code>, and <code>PORT</code> configure the local server.</p>
      <Search /><FixturePanel />
    </details>
    <details><summary>Activity and runtime logs</summary><pre id="logs" aria-label="Activity log" className="bg-neutral-100 p-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{state.logs.join("\n")}</pre></details>
  </main>;
}

createRoot(document.getElementById("root")!).render(<WorkspaceProvider><App /></WorkspaceProvider>);
