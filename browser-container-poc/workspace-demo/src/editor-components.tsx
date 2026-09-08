import { useEffect, useRef, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import { attachPreview } from "@vivari/workspace-api";
import { useWorkspace } from "@vivari/workspace-api/react";
import { sourcePaths } from "./sample-recipe";
import { mountChat } from "./chat-adapter";
import { Button } from "./components/ui/button";

const decoder = new TextDecoder();
export function FileEditor({ dirty, setDirty }: { dirty: boolean; setDirty(value: boolean): void }) {
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
export function Preview() {
  const { controller, state } = useWorkspace();
  const frame = useRef<HTMLIFrameElement>(null);
  const service = state.services.vite;
  useEffect(() => {
    if (!service || !frame.current) return;
    const target = frame.current;
    let observer: MutationObserver | undefined;
    const loaded = () => {
      try {
        if (!target.contentWindow?.location.pathname.startsWith("/preview/")) return;
        const check = () => { if (target.contentDocument?.getElementById("root")?.childElementCount) { observer?.disconnect(); controller.clientReady("vite"); } };
        observer?.disconnect(); observer = new MutationObserver(check);
        if (target.contentDocument) observer.observe(target.contentDocument, { childList: true, subtree: true });
        check();
      }
      catch (error) { controller.clientFailed("vite", error); }
    };
    target.addEventListener("load", loaded);
    try {
      const attachment = attachPreview(target, service.endpoint, { hostPaths: ["/api"] });
      return controller.registerAttachment("vite", () => { observer?.disconnect(); target.removeEventListener("load", loaded); attachment.dispose(); target.src = "about:blank"; });
    } catch (error) { target.removeEventListener("load", loaded); controller.clientFailed("vite", error); }
  }, [controller, service]);
  return <iframe id="preview" ref={frame} title="Workspace preview" style={{ position: "fixed", inset: 0, width: "100%", height: "100%", border: 0, background: "white", zIndex: 10, visibility: state.clients.vite === "ready" ? "visible" : "hidden" }} />;
}
export function Chat() {
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
