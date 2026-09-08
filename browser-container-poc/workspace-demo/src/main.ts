import { Workspace, Runtime, opfsStore, attachPreview, type Distribution, type Execution, type Endpoint, type PreviewAttachment, type NodeLaunchOptions } from "../../workspace-api/src/index";
import { openFixture, starterFiles } from "./fixture";
import { mountChat, type ChatMount } from "./chat-adapter";
import { loadPrepared, preparedApps, openCodeLaunch, waitForOpenCode, type PreparedManifest } from "./prepared";

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => element<HTMLInputElement>(id);
const text = (id: string, value: string) => { element(id).textContent = value; };
const decoder = new TextDecoder();
const editor = element<HTMLTextAreaElement>("editor");
const mode = element<HTMLSelectElement>("mode");
const frame = element<HTMLIFrameElement>("preview");
let workspace: Workspace | undefined;
let runtime: Runtime<{ apps: ReturnType<typeof preparedApps> }> | undefined;
let prepared: PreparedManifest | undefined;
let placeholderRuntime = false;
let placeholderPreview = false;
let attachment: PreviewAttachment | undefined;
let chat: ChatMount | undefined;
let busy = false;
let distribution: Distribution | undefined;
type Service = { execution: Execution; endpoint: Endpoint; drained: Promise<void> };
let vite: Service | undefined;
let chatServer: Service | undefined;
const fixture = () => mode.value === "fixture";
const running = () => !!runtime || placeholderRuntime;
function log(message: string) {
  const target = element("logs");
  target.textContent = (target.textContent + `${new Date().toLocaleTimeString()} ${message}\n`).slice(-24000);
  target.scrollTop = target.scrollHeight;
}
function status(message: string) { text("status", message); log(message); }
function update() {
  mode.disabled = busy || !!workspace;
  const enabled: Record<string, boolean> = {
    open: !workspace, "start-runtime": !!workspace && !running(), "stop-runtime": running(),
    prepare: !!runtime && !vite && !chatServer,
    flush: !!workspace, close: !!workspace && !running(), save: !!workspace, readback: !!workspace, seed: !!workspace,
    search: !!workspace, "start-vite": running() && !vite && !placeholderPreview, "stop-vite": !!vite || placeholderPreview,
    "start-chat": running() && !chat && !chatServer, "stop-chat": !!chat || !!chatServer,
  };
  for (const [id, on] of Object.entries(enabled)) element<HTMLButtonElement>(id).disabled = busy || !on;
  text("mode-note", fixture()
    ? "FIXTURE / PLACEHOLDER MODE — files are an editable in-memory fixture with explicit localStorage snapshots. Runtime controls simulate UI state only. Preview renders /index.html directly, without Vite or HMR. Chat uses the component’s mock mode."
    : "SHARED API MODE — open files, add missing example files, start runtime, deliver prepared apps, then launch Vite or OpenCode. Dependencies are restored explicitly after reopen. No fixture fallback.");
  text("lifecycle", `Workspace: ${workspace ? fixture() ? "fixture open · localStorage snapshots" : "open · " + workspace.persistence.status : "closed"} | Runtime: ${placeholderRuntime ? "placeholder active (no execution)" : runtime ? "active" : "stopped"}`);
  text("start-runtime", fixture() ? "Start placeholder runtime" : "Start runtime");
  text("start-vite", fixture() ? "Show static fixture preview" : "Launch Vite");
  text("start-chat", fixture() ? "Open chat fixture" : "Launch OpenCode server + chat");
  text("flush", fixture() ? "Save localStorage snapshot" : "Flush workspace");
}
function action(id: string, fn: () => Promise<void>) {
  element(id).onclick = async () => {
    if (busy) return;
    busy = true; update();
    try { await fn(); } catch (error) { status(`Failed: ${error instanceof Error ? error.message : String(error)}`); }
    finally { busy = false; update(); }
  };
}
async function paths(directory = "/"): Promise<string[]> {
  const found: string[] = [];
  for (const name of await workspace!.fs.readdir(directory)) {
    const path = `${directory === "/" ? "" : directory}/${name}`;
    // Project dependencies are not useful in this small source editor.
    if (name === "node_modules" || name === ".git" || name === ".opencode-state") continue;
    const stat = await workspace!.fs.stat(path);
    if (stat.isDirectory) found.push(...await paths(path)); else found.push(path);
  }
  return found.sort();
}
async function refreshFiles() {
  const select = element<HTMLSelectElement>("files");
  select.replaceChildren(...(await paths()).map((path) => new Option(path, path)));
  select.value = input("file-path").value;
}
async function readFile() {
  editor.value = decoder.decode(await workspace!.fs.readFile(input("file-path").value));
  text("editor-status", `Read ${input("file-path").value}`);
}
async function refreshPreview() {
  if (!placeholderPreview) return;
  frame.srcdoc = decoder.decode(await workspace!.fs.readFile("/index.html"));
  text("preview-status", "Static fixture /index.html · scripts sandboxed · no Vite, module transform, or HMR");
}
async function drain(stream: AsyncIterable<Uint8Array>, label: string) {
  const decoder = new TextDecoder();
  try { for await (const bytes of stream) log(`[${label}] ${decoder.decode(bytes, { stream: true })}`); const tail = decoder.decode(); if (tail) log(`[${label}] ${tail}`); }
  catch (error) { log(`[${label}] stream failed: ${String(error)}`); }
}
async function launch(options: NodeLaunchOptions, port: number, label: string): Promise<Service> {
  const execution = await runtime!.node(options);
  const drained = Promise.all([drain(execution.stdout, `${label}:stdout`), drain(execution.stderr, `${label}:stderr`)]).then(() => {});
  void execution.exited.then((result) => { log(`${label} exited: ${JSON.stringify(result)}`); text(label === "Vite" ? "preview-status" : "chat-status", `${label} exited; stop/detach before relaunching`); }, (error) => log(`${label} exit failed: ${String(error)}`));
  try { return { execution, drained, endpoint: await runtime!.expose(port, { signal: AbortSignal.timeout(30000) }) }; }
  catch (error) { await execution.stop(); await drained; throw error; }
}
async function stopService(service: Service | undefined) {
  if (!service) return;
  service.endpoint.dispose();
  await service.execution.stop();
  await service.drained;
}
async function stopPreview() {
  attachment?.dispose(); attachment = undefined;
  await stopService(vite); vite = undefined;
  placeholderPreview = false;
  frame.removeAttribute("srcdoc"); frame.src = "about:blank";
  text("preview-status", "Detached");
}
async function stopChat() {
  chat?.dispose(); chat = undefined;
  await stopService(chatServer); chatServer = undefined;
  text("chat-status", "Detached"); text("chat", "Chat detached.");
}
action("open", async () => {
  if (!fixture() && JSON.parse(input("distribution").value).version === "unconfigured") {
    const response = await fetch("/runtime/distribution.json");
    if (!response.ok) throw Error(`Runtime manifest HTTP ${response.status}; build workspace-api distribution first`);
    const manifest = await response.json();
    input("distribution").value = JSON.stringify({ name: "vivari", version: manifest.version, assetBaseUrl: "/runtime/" });
  }
  distribution = JSON.parse(input("distribution").value) as Distribution;
  workspace = fixture() ? openFixture() : await Workspace.open({ id: "default", storage: opfsStore(distribution), signal: AbortSignal.timeout(120000), onPersistenceChange: () => update() });
  await refreshFiles();
  const first = element<HTMLSelectElement>("files").options[0]?.value;
  if (first) { input("file-path").value = first; await readFile(); }
  status(fixture() ? "Fixture workspace open; runtime has not started" : "Workspace open; runtime has not started");
});
action("start-runtime", async () => {
  if (fixture()) { placeholderRuntime = true; status("Placeholder runtime active — no backend execution started"); }
  else {
    prepared = await loadPrepared();
    if (prepared.runtimeVersion !== distribution!.version) throw Error("Prepared apps target a different runtime; rerun bun run prepare");
    runtime = await Runtime.start({ workspace: workspace!, distribution: distribution!, tools: { apps: preparedApps(prepared, log) } });
    input("vite-entry").value = prepared.vite.entry;
    input("chat-entry").value = prepared.opencode.entry;
    input("chat-args").value = JSON.stringify(prepared.opencode.args);
    status("Runtime started; no project programs launched");
  }
});
action("prepare", async () => { await runtime!.tools.apps(); status("Prepared dependencies and OpenCode delivered; launch services separately"); });
action("stop-runtime", async () => {
  const detached = await Promise.allSettled([stopPreview(), stopChat()]);
  await runtime?.stop(); runtime = undefined; placeholderRuntime = false;
  vite = undefined; chatServer = undefined;
  for (const result of detached) if (result.status === "rejected") log(`Detach cleanup failed: ${String(result.reason)}`);
  status("Runtime stopped; workspace files remain accessible");
});
action("flush", async () => { await workspace!.flush(); status(fixture() ? "Fixture snapshot saved to localStorage (not API durable-flush evidence)" : "Workspace flush acknowledged"); });
action("close", async () => {
  await workspace!.close(); workspace = undefined; editor.value = "";
  element<HTMLSelectElement>("files").replaceChildren(new Option("No workspace open"));
  status(fixture() ? "Fixture closed; reopen restores the last explicit snapshot" : "Workspace close acknowledged");
});
action("save", async () => {
  const path = input("file-path").value;
  await workspace!.fs.writeFile(path, editor.value); await refreshFiles(); await refreshPreview();
  text("editor-status", `Wrote ${path}; snapshot / flush separately to persist`); status(`Wrote ${path}`);
});
action("readback", readFile);
element<HTMLSelectElement>("files").onchange = () => { input("file-path").value = element<HTMLSelectElement>("files").value; element<HTMLButtonElement>("readback").click(); };
action("seed", async () => {
  const existing = new Set(await paths());
  await workspace!.fs.mkdir("/src");
  const files = fixture() ? starterFiles : (await loadPrepared()).project;
  for (const [path, content] of Object.entries(files)) if (!existing.has(path)) await workspace!.fs.writeFile(path, content.replaceAll("__MODEL_PROXY__", `http://host.vivari.internal:${location.port}/api/model/opencode`));
  await refreshFiles(); status("Added missing example files; dependencies still need explicit preparation");
});
action("search", async () => {
  const query = input("query").value;
  if (!query) throw new Error("Enter literal search text");
  const matches: string[] = [];
  for (const path of await paths()) {
    const bytes = await workspace!.fs.readFile(path);
    if (bytes.length > 1024 * 1024 || bytes.includes(0)) continue;
    const lines = decoder.decode(bytes).split("\n");
    for (let i = 0; i < lines.length; i++) if (lines[i]!.includes(query)) {
      matches.push(`${path}:${i + 1}: ${lines[i]}`);
      if (matches.length === 100) { text("matches", matches.join("\n") + "\nStopped at 100 matches."); return; }
    }
  }
  text("matches", matches.length ? matches.join("\n") : "No matches");
});
action("start-vite", async () => {
  if (fixture()) { frame.setAttribute("sandbox", "allow-scripts"); placeholderPreview = true; try { await refreshPreview(); } catch (error) { placeholderPreview = false; throw error; } status("Static fixture preview shown; Vite is not running"); return; }
  frame.removeAttribute("sandbox"); // Current public preview transport is a trusted same-origin adapter.
  vite = await launch({ ...prepared!.vite, entry: input("vite-entry").value }, 5173, "Vite");
  try { attachment = attachPreview(frame, vite.endpoint); text("preview-status", `Vite attached: ${vite.endpoint.url} · HMR requires transport support`); }
  catch (error) { await stopPreview(); throw error; }
});
action("stop-vite", stopPreview);
action("start-chat", async () => {
  element("chat").replaceChildren();
  if (fixture()) { chat = await mountChat(element("chat"), { mock: true, directory: "/workspace" }); text("chat-status", "Chat fixture · no OpenCode server or model request"); return; }
  const connection = openCodeLaunch({ ...prepared!.opencode, entry: input("chat-entry").value, args: JSON.parse(input("chat-args").value) });
  chatServer = await launch(connection.options, 4096, "OpenCode");
  try {
    const endpoint = chatServer.endpoint;
    log(`Guest OpenCode health: ${await waitForOpenCode(endpoint, connection.headers)}`);
    // Workspace Endpoint accepts a URL string; the chat component accepts native Fetch inputs.
    const fetchAdapter: typeof fetch = async (input, init) => {
      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
      headers.set("authorization", connection.headers.authorization);
      init = { ...init, headers };
      if (input instanceof Request) {
        const request = new Request(input, init);
        return endpoint.fetch(request.url, { method: request.method, headers: request.headers, body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(), signal: request.signal, credentials: request.credentials, cache: request.cache, redirect: request.redirect });
      }
      return endpoint.fetch(String(input), init);
    };
    chat = await mountChat(element("chat"), { endpoint: { url: endpoint.url, fetch: fetchAdapter }, mock: false, directory: "/workspace" });
    text("chat-status", `OpenCode client attached: ${endpoint.url} · connection status is reported by the client`);
  } catch (error) { await stopChat(); throw error; }
});
action("stop-chat", stopChat);
mode.onchange = update;
window.addEventListener("beforeunload", () => { chat?.dispose(); attachment?.dispose(); void runtime?.stop(); });
update();
