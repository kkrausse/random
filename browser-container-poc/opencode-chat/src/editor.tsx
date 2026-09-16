import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { WorkspaceProvider, useWorkspace, type Service, type WorkspaceController } from "@kev-browser-agent-kit/workspace/react";
import type { ChatController } from "./types";
import { ChatView } from "./react";
import { attachChat, editorLifecycle } from "./editor-adapter";
import { Button } from "./components/ui/button";
import { createBrowserEditorRecipe } from "./recipe";
export { attachChat, chatFor, type WorkspaceChatOptions } from "./editor-adapter";
export { sourcePaths } from "./editor-source";

export interface BrowserEditorProps {
  controller: WorkspaceController;
  /** Supply to start on mount and close on unmount. Omit for host-managed lifecycle. */
  recipe?: { start(controller: WorkspaceController): Promise<void> };
  onExit?(): void;
  onRetry?(): void;
  /** Optional host recipe action; does not imply remote archival/reset semantics. */
  onReset?(): Promise<void>;
  previewService?: string;
  chatService?: string;
  directory?: string;
  hostPaths?: string[];
  /** Optional application-specific rendered-content check. Default: iframe load. */
  isPreviewReady?(frame: HTMLIFrameElement): boolean;
}
export type PreparedBrowserEditorProps = Omit<BrowserEditorProps, "controller" | "recipe"> & {
  /** Prepared assets, runtime and model proxy root. Default: /editor/. Captured on mount. */
  base?: string;
  /** Default model for the prepared workspace. Captured on mount. */
  model?: string;
};

/** Mount only while editing is authorized and open. Composes the default prepared
 * recipe and workspace lifecycle; the host owns authorization and the launcher. */
export function PreparedBrowserEditor(props: PreparedBrowserEditorProps) {
  return <WorkspaceProvider><PreparedEditor {...props} /></WorkspaceProvider>;
}

function PreparedEditor({ base, model, ...props }: PreparedBrowserEditorProps) {
  const { controller } = useWorkspace();
  const [recipe] = useState(() => createBrowserEditorRecipe({ base, model }));
  return <BrowserEditor {...props} controller={controller} recipe={recipe} />;
}

const noHostPaths: string[] = [];
export function BrowserEditor({ controller, recipe, onExit, onRetry, onReset, previewService = "vite", chatService = "chat", directory = "/workspace", hostPaths = noHostPaths, isPreviewReady }: BrowserEditorProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const start = useRef(recipe); start.current = recipe;
  const [retry, setRetry] = useState(0), [chatOpen, setChatOpen] = useState(true);
  const [exiting, setExiting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const managed = !!recipe;
  useEffect(() => {
    if (managed) return editorLifecycle(controller, owner => start.current!.start(owner));
  }, [controller, managed, retry]);
  return <div className="oc-editor">
    <EditorPreview controller={controller} service={state.services[previewService]} name={previewService} hostPaths={hostPaths} isReady={isPreviewReady} />
    <aside className="oc-editor-panel" aria-label="Editing controls">
      <header className="oc-editor-actions">
        <Button onClick={() => setChatOpen(!chatOpen)} aria-expanded={chatOpen}>Chat</Button>
        {onReset && <Button disabled={state.busy || exiting || resetting || !state.runtime} onClick={() => { setResetting(true); void Promise.resolve().then(onReset).catch(error => controller.reportError(error)).finally(() => setResetting(false)); }}>Reset source</Button>}
        {onExit && <Button disabled={exiting || resetting} onClick={() => { setExiting(true); void Promise.resolve().then(onExit).catch(error => controller.reportError(error)).finally(() => setExiting(false)); }}>Exit</Button>}
      </header>
      <p role="status">{state.status}</p>
      {state.error && <div role="alert"><p>{state.error}</p>{(managed || onRetry) && <Button disabled={state.busy} onClick={() => onRetry ? onRetry() : setRetry(value => value + 1)}>Retry editing</Button>}</div>}
      <p>Workspace: {state.workspace ? state.persistence : "closed"} · Runtime: {state.runtime ? "active" : "stopped"}</p>
      <div hidden={!chatOpen}><EditorChat controller={controller} service={state.services[chatService]} name={chatService} directory={directory} /></div>
      <details><summary>Activity</summary><pre>{state.logs.join("\n")}</pre></details>
    </aside>
  </div>;
}

function EditorChat({ controller, service, name, directory }: { controller: WorkspaceController; service?: Service; name: string; directory: string }) {
  const [chat, setChat] = useState<ChatController>(), [error, setError] = useState("");
  useEffect(() => {
    let active = true; setChat(undefined); setError("");
    if (service) void attachChat(controller, service, { serviceName: name, directory }).then(value => { if (active) setChat(value); }, error => { if (active) setError(String(error)); });
    return () => { active = false; };
  }, [controller, service, name, directory]);
  return <div className="oc-editor-chat">{error ? <p role="alert">{error}</p> : chat ? <ChatView controller={chat} /> : <p>Waiting for OpenCode connection…</p>}</div>;
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
