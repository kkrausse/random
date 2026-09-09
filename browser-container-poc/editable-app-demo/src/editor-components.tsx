import { useEffect, useRef, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import { useWorkspace } from "@kev-browser-agent-kit/workspace/react";
import { sourcePaths } from "./sample-recipe";
import { chatFor } from "./chat-adapter";
import { ChatView } from "@kev-browser-agent-kit/opencode-chat/react";
import { Button } from "./components/ui/button";

const decoder = new TextDecoder();
export type FileRequest = { path: string; selection?: { startLine: number; endLine: number } };
export function FileEditor({ dirty, setDirty, request }: { dirty: boolean; setDirty(value: boolean): void; request?: FileRequest }) {
  const { controller, state } = useWorkspace();
  const [paths, setPaths] = useState<string[]>([]);
  const [path, setPath] = useState("/src/App.tsx");
  const [contents, setContents] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const handled = useRef<FileRequest | undefined>(undefined);
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
  useEffect(() => {
    if (!request || handled.current === request || state.busy || !state.workspace) return;
    handled.current = request;
    void read(request.path).then(() => {
      const input = textarea.current;
      if (!input || dirty) return;
      // Let React commit the loaded bytes before focusing/selecting native lines.
      requestAnimationFrame(() => {
        input.focus();
        if (!request.selection) return;
        const lines = input.value.split("\n");
        const offset = (line: number) => lines.slice(0, Math.max(0, line - 1)).reduce((n, value) => n + value.length + 1, 0);
        input.setSelectionRange(offset(request.selection.startLine), offset(request.selection.endLine + 1));
      });
    });
  }, [request, state.busy, state.workspace]);
  return <section className="min-w-0 space-y-3" aria-labelledby="editor-heading">
    <h2 id="editor-heading">Guest source editor</h2>
    <label className="block">Files <select aria-label="Files" className="max-w-full" disabled={state.busy || !state.workspace || dirty} value={path} onChange={event => void read(event.target.value)}>
      {!paths.length && <option value="/src/App.tsx">No workspace open</option>}{paths.map(file => <option key={file}>{file}</option>)}
    </select></label>
    <label className="block">Path <input aria-label="Path" value={path} disabled={state.busy || !state.workspace} onChange={event => setPath(event.target.value)} /></label>
    <textarea ref={textarea} aria-label="File contents" className="w-full h-80 font-mono" spellCheck={false} value={contents} disabled={state.busy || !state.workspace} onChange={event => { setContents(event.target.value); setDirty(true); setNote("Unsaved changes — Save file before switching files or restarting."); }} />
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
      const attachment = service.endpoint.attachPreview(target, { hostPaths: ["/api"] });
      return controller.registerAttachment("vite", () => { observer?.disconnect(); target.removeEventListener("load", loaded); attachment.dispose(); target.src = "about:blank"; });
    } catch (error) { target.removeEventListener("load", loaded); controller.clientFailed("vite", error); }
  }, [controller, service]);
  return <iframe id="preview" ref={frame} title="Workspace preview" style={{ position: "fixed", inset: 0, width: "100%", height: "100%", border: 0, background: "white", zIndex: 10, visibility: state.clients.vite === "ready" ? "visible" : "hidden" }} />;
}
export function Chat({ onOpenFile }: { onOpenFile(path: string, selection?: FileRequest["selection"]): void }) {
  const { state } = useWorkspace();
  const service = state.services.chat;
  const chat = service && chatFor(service);
  return <section className="space-y-3" aria-labelledby="chat-heading">
    <h2 id="chat-heading">OpenCode chat</h2>
    <p className="text-sm text-neutral-600">{service ? `Guest OpenCode · ${state.clients.chat}. New workspaces default to Muse Spark (free).` : "Start workspace to connect real guest OpenCode."} Try: “Add a Reset button to /workspace/src/App.tsx.” It edits the same guest source Vite serves.</p>
    <div id="chat" style={{ height: "min(52vh, 560px)", minHeight: 240 }}>{chat ? <ChatView controller={chat} showSessions showModels onOpenFile={onOpenFile} /> : state.error ? <p role="alert">Guest chat unavailable: {state.error}</p> : <p>{state.busy ? "Waiting for guest chat connection…" : "Start workspace to connect guest chat."}</p>}</div>
  </section>;
}
