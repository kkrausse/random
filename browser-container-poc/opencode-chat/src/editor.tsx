import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Workspace } from "@kev-browser-agent-kit/workspace";
import type { Service, WorkspaceController } from "@kev-browser-agent-kit/workspace/react";
import type { ChatController } from "./types";
import { ChatView, type OpenFile } from "./react";
import { attachChat, editorLifecycle } from "./editor-adapter";
import { SourceDocument, sourcePaths } from "./editor-source";
import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import { ChoiceSelect } from "./components/ui/select";
export { attachChat, chatFor, type WorkspaceChatOptions } from "./editor-adapter";
export { sourcePaths } from "./editor-source";

export interface BrowserEditorProps {
  controller: WorkspaceController;
  /** Supply to start on mount and flush/close on unmount. Omit for host-managed lifecycle. */
  recipe?: { start(controller: WorkspaceController): Promise<void> };
  onExit?(): void;
  onRetry?(): void;
  /** Optional host recipe action; does not imply remote archival/reset semantics. */
  onReset?(): Promise<void>;
  previewService?: string;
  chatService?: string;
  directory?: string;
  hostPaths?: string[];
  initialPath?: string;
  listFiles?(workspace: Workspace): Promise<string[]>;
  autosaveMs?: number;
  /** Optional application-specific rendered-content check. Default: iframe load. */
  isPreviewReady?(frame: HTMLIFrameElement): boolean;
}
const noHostPaths: string[] = [];
export function BrowserEditor({ controller, recipe, onExit, onRetry, onReset, previewService = "vite", chatService = "chat", directory = "/workspace", hostPaths = noHostPaths, initialPath, listFiles = sourcePaths, autosaveMs = 1000, isPreviewReady }: BrowserEditorProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const document = useMemo(() => state.workspace ? new SourceDocument(state.workspace) : undefined, [state.workspace]);
  const currentDocument = useRef(document); currentDocument.current = document;
  const start = useRef(recipe); start.current = recipe;
  const [retry, setRetry] = useState(0), [sourceOpen, setSourceOpen] = useState(false), [chatOpen, setChatOpen] = useState(true);
  const [exiting, setExiting] = useState(false);
  const [resetting, setResetting] = useState(false), [sourceRevision, setSourceRevision] = useState(0);
  const [request, setRequest] = useState<{ path: string; selection?: { startLine: number; endLine: number } }>();
  const managed = !!recipe;
  useEffect(() => {
    if (managed) return editorLifecycle(controller, owner => start.current!.start(owner), () => currentDocument.current?.flush() ?? Promise.resolve());
  }, [controller, managed, retry]);
  const openFile: OpenFile = (path, selection) => {
    setSourceOpen(true);
    const prefix = directory.replace(/\/$/, "");
    setRequest({ path: path.startsWith(`${prefix}/`) ? path.slice(prefix.length) : path.startsWith("/") ? path : `/${path}`, selection });
  };
  return <div className="oc-editor">
    <EditorPreview controller={controller} service={state.services[previewService]} name={previewService} hostPaths={hostPaths} isReady={isPreviewReady} />
    <aside className="oc-editor-panel" aria-label="Editing controls">
      <header className="oc-editor-actions">
        <Button onClick={() => setChatOpen(!chatOpen)} aria-expanded={chatOpen}>Chat</Button>
        <Button onClick={() => setSourceOpen(!sourceOpen)} aria-expanded={sourceOpen}>Source</Button>
        {onReset && <Button disabled={state.busy || exiting || resetting || !state.runtime} onClick={() => { setResetting(true); void (document?.flush() ?? Promise.resolve()).then(onReset).then(() => setSourceRevision(value => value + 1)).catch(error => controller.reportError(error)).finally(() => setResetting(false)); }}>Reset source</Button>}
        {onExit && <Button disabled={exiting || resetting} onClick={() => { setExiting(true); void (document?.flush() ?? Promise.resolve()).then(onExit).catch(error => controller.reportError(error)).finally(() => setExiting(false)); }}>Exit</Button>}
      </header>
      <p role="status">{state.status}</p>
      {state.error && <div role="alert"><p>{state.error}</p>{(managed || onRetry) && <Button disabled={state.busy || document?.dirty} onClick={() => onRetry ? onRetry() : setRetry(value => value + 1)}>Retry editing</Button>}</div>}
      <p>Workspace: {state.workspace ? state.persistence : "closed"} · Runtime: {state.runtime ? "active" : "stopped"}</p>
      <div hidden={!chatOpen}><EditorChat controller={controller} service={state.services[chatService]} name={chatService} directory={directory} onOpenFile={openFile} /></div>
      <div hidden={!sourceOpen}>{document && state.workspace ? <SourceEditor key={`${state.workspace.id}:${sourceRevision}`} document={document} workspace={state.workspace} initialPath={initialPath} listFiles={listFiles} delay={autosaveMs} request={request} busy={state.busy || exiting || resetting} /> : <p>Waiting for workspace…</p>}</div>
      <details><summary>Activity</summary><pre>{state.logs.join("\n")}</pre></details>
    </aside>
  </div>;
}

function EditorChat({ controller, service, name, directory, onOpenFile }: { controller: WorkspaceController; service?: Service; name: string; directory: string; onOpenFile: OpenFile }) {
  const [chat, setChat] = useState<ChatController>(), [error, setError] = useState("");
  useEffect(() => {
    let active = true; setChat(undefined); setError("");
    if (service) void attachChat(controller, service, { serviceName: name, directory }).then(value => { if (active) setChat(value); }, error => { if (active) setError(String(error)); });
    return () => { active = false; };
  }, [controller, service, name, directory]);
  return <div className="oc-editor-chat">{error ? <p role="alert">{error}</p> : chat ? <ChatView controller={chat} onOpenFile={onOpenFile} /> : <p>Waiting for OpenCode connection…</p>}</div>;
}

function EditorPreview({ controller, service, name, hostPaths, isReady }: { controller: WorkspaceController; service?: Service; name: string; hostPaths: string[]; isReady?: BrowserEditorProps["isPreviewReady"] }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    const target = frame.current;
    if (!service || !target) return;
    let observer: MutationObserver | undefined;
    const check = () => {
      try { if (!isReady || isReady(target)) { observer?.disconnect(); setReady(true); controller.clientReady(name); } }
      catch (error) { controller.clientFailed(name, error); }
    };
    const loaded = () => {
      if (target.getAttribute("src") === "about:blank") return;
      // attachPreview navigates through about:blank; ignore its queued load.
      try { if (target.contentWindow?.location.href === "about:blank") return; } catch { /* cross-origin preview */ }
      if (isReady) {
        try { observer?.disconnect(); observer = new MutationObserver(check); if (target.contentDocument) observer.observe(target.contentDocument, { childList: true, subtree: true }); }
        catch (error) { controller.clientFailed(name, error); }
      }
      check();
    };
    target.addEventListener("load", loaded);
    try {
      const attachment = service.endpoint.attachPreview(target, { hostPaths });
      return controller.registerAttachment(name, () => { observer?.disconnect(); target.removeEventListener("load", loaded); attachment.dispose(); target.src = "about:blank"; });
    } catch (error) { target.removeEventListener("load", loaded); controller.clientFailed(name, error); }
  }, [controller, service, name, hostPaths, isReady]);
  return <iframe className="oc-editor-preview" ref={frame} title="Workspace preview" style={{ visibility: ready ? "visible" : "hidden" }} />;
}

function SourceEditor({ document, workspace, initialPath, listFiles, delay, request, busy }: { document: SourceDocument; workspace: Workspace; initialPath?: string; listFiles: NonNullable<BrowserEditorProps["listFiles"]>; delay: number; request?: { path: string; selection?: { startLine: number; endLine: number } }; busy: boolean }) {
  const [paths, setPaths] = useState<string[]>([]), [version, render] = useState(0), [loading, setLoading] = useState(false), [note, setNote] = useState("");
  const input = useRef<HTMLTextAreaElement>(null), active = useRef(false), handled = useRef<typeof request>(undefined);
  const update = () => { if (active.current) render(value => value + 1); };
  const read = async (path: string) => {
    setLoading(true);
    try { if (await document.open(path)) { if (active.current) setNote(`Read ${path}`); update(); } }
    catch (error) { if (active.current) setNote(String(error)); }
    finally { if (active.current) setLoading(false); }
  };
  useEffect(() => {
    active.current = true;
    let cancelled = false;
    // A workspace is published before the recipe seeds/delivers its files.
    // Wait for startup/reset to settle, then discover the resulting tree.
    if (busy || document.dirty) return () => { active.current = false; };
    void listFiles(workspace).then(async files => {
      if (cancelled) return;
      setPaths(files);
      const path = initialPath ?? files[0];
      if (path) await read(path);
    }).catch(error => { if (!cancelled) setNote(String(error)); });
    return () => { cancelled = true; active.current = false; };
  }, [document, workspace, listFiles, initialPath, busy]);
  useEffect(() => {
    if (busy) return;
    let saving = false;
    const timer = setInterval(() => {
      if (!document.dirty || saving) return;
      saving = true;
      setNote("Writing local workspace…");
      void document.flush().then(() => { if (active.current) { setNote(document.dirty ? "Changes pending…" : "Written and flushed to local workspace. Not published to a remote server."); update(); } }, error => { if (active.current) setNote(`Local autosave failed: ${String(error)}. Retrying automatically.`); }).finally(() => { saving = false; });
    }, delay);
    return () => clearInterval(timer);
  }, [document, busy, delay]);
  useEffect(() => {
    if (!request || handled.current === request || busy || loading || document.dirty) return;
    handled.current = request;
    void read(request.path).then(() => {
      if (!active.current || document.path !== request.path) return;
      requestAnimationFrame(() => {
        if (!active.current || !input.current) return;
        input.current.focus();
        if (request.selection) {
          const lines = input.current.value.split("\n");
          const offset = (line: number) => lines.slice(0, Math.max(0, line - 1)).reduce((sum, text) => sum + text.length + 1, 0);
          input.current.setSelectionRange(offset(request.selection.startLine), offset(request.selection.endLine + 1));
        }
      });
    });
  }, [request, busy, loading, version, document]);
  return <section className="oc-editor-source" aria-label="Source editor">
    <label>File <ChoiceSelect label="Source file" value={document.path} disabled={busy || loading || document.dirty} onValueChange={value => void read(value)} placeholder="Choose file"
      items={(document.path && !paths.includes(document.path) ? [document.path, ...paths] : paths).map(path => ({ value: path, label: path }))}
    /></label>
    <Button disabled={busy || loading || document.dirty || !document.path} onClick={() => void read(document.path)}>Reload file</Button>
    <Textarea ref={input} aria-label="File contents" spellCheck={false} disabled={busy || loading || !document.path} value={document.text} onChange={event => { document.edit(event.target.value); setNote("Changes pending local autosave…"); update(); }} />
    <p role="status">{note}</p>
    <p>Autosaves locally while editing. Reload file to pick up agent edits.</p>
  </section>;
}
