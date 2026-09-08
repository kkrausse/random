// Placeholder demo consumer mirroring api-plan.md "Proposed usage".
// Intended import (not yet implemented): `import { Workspace, Runtime, attachPreview } from "workspace-api";`
// Until task F1 (`workspace-api/`) lands, everything below is wired to `./api-stub`
// which throws `not implemented` so the demo typechecks but reports honest failure.
import {
  Workspace,
  Runtime,
  attachPreview,
  consumeOutput,
  type EndpointHandle,
  type ExecutionHandle,
  type PreviewAttachment,
  type Workspace as WorkspaceT,
  type Runtime as RuntimeT,
} from "./api-stub";

const $ = <T extends HTMLElement>(id: string) =>
  document.querySelector<T>(`#${id}`)!;

const statusEl = $("status");
const logsEl = $("logs");
const editorEl = $("editor") as unknown as HTMLTextAreaElement;
const queryEl = $("query") as unknown as HTMLInputElement;
const matchesEl = $("matches");
const previewEl = $("preview") as unknown as HTMLIFrameElement;

function log(s: string) {
  logsEl.textContent += s + "\n";
}
function status(s: string) {
  statusEl.textContent = s;
  log(new Date().toISOString() + " " + s);
}

let workspace: WorkspaceT | undefined;
let runtime: RuntimeT | undefined;
let vite: ExecutionHandle | undefined;
let endpoint: EndpointHandle | undefined;
let attachment: PreviewAttachment | undefined;
let logDrain: Promise<void> | undefined;

$("open").onclick = async () => {
  try {
    status("Opening workspace…");
    workspace = await Workspace.open({ id: "my-project" });
    runtime = await Runtime.start({ workspace, tools: {} });
    status("Workspace open, runtime started");
    (
      ["start-vite", "flush"] as const
    ).forEach((id) => ($(`${id}`) as HTMLButtonElement).disabled = false);
  } catch (e) {
    status("Failed: " + String(e));
  }
};

$("save").onclick = async () => {
  try {
    if (!workspace) throw new Error("open workspace first");
    await workspace.fs.writeFile("/src/App.tsx", editorEl.value);
    log("wrote /src/App.tsx");
  } catch (e) {
    log(String(e));
  }
};

$("readback").onclick = async () => {
  try {
    if (!workspace) throw new Error("open workspace first");
    editorEl.value = await workspace.fs.readFile("/src/App.tsx");
    log("read back /src/App.tsx");
  } catch (e) {
    log(String(e));
  }
};

$("search").onclick = async () => {
  try {
    if (!runtime) throw new Error("open workspace first");
    const matches = await runtime.tools.ripgrep({
      pattern: queryEl.value,
      paths: ["/workspace/src"],
    });
    matchesEl.textContent = JSON.stringify(matches, null, 2);
  } catch (e) {
    log(String(e));
  }
};

$("start-vite").onclick = async () => {
  try {
    if (!runtime) throw new Error("open workspace first");
    vite = await runtime.node({
      entry: "/workspace/node_modules/vite/bin/vite.js",
      args: ["--port", "5173", "--strictPort"],
      cwd: "/workspace",
      env: {},
    });
    logDrain = consumeOutput(vite.stdout, vite.stderr, (stream, bytes) =>
      log(`[${stream}] ${new TextDecoder().decode(bytes)}`),
    );
    endpoint = await runtime.expose(5173, {
      signal: AbortSignal.timeout(30_000),
    });
    attachment = attachPreview(previewEl, endpoint);
    status("Vite attached");
    ($("stop-vite") as HTMLButtonElement).disabled = false;
  } catch (e) {
    status("Failed: " + String(e));
  }
};

$("stop-vite").onclick = async () => {
  try {
    attachment?.dispose();
    attachment = undefined;
    await vite?.stop();
    vite = undefined;
    await logDrain;
    endpoint?.close();
    endpoint = undefined;
    status("Vite stopped, preview detached");
  } catch (e) {
    log(String(e));
  }
};

$("flush").onclick = async () => {
  try {
    attachment?.dispose();
    await vite?.stop().catch(() => {});
    await runtime?.stop();
    await workspace?.flush();
    await workspace?.close();
    workspace = runtime = vite = endpoint = attachment = undefined;
    status("Flushed and closed");
  } catch (e) {
    log(String(e));
  }
};
