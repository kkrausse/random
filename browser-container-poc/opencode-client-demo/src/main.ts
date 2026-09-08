// Placeholder browser chat client for task F2 (api-handoff.md).
// Concept: OpenCode server launched explicitly as an ordinary application via
// `Runtime.node({ entry: <serve entry> })` + `runtime.expose(port)` endpoint,
// with this small chat client talking to it through the endpoint fetch adapter.
// This is NOT the TUI demo (see opencode-demo/main.ts, unmodified).
//
// Imports ONLY from ./opencode-stub (stubbed until workspace-api F1/C2 land).
// Never from kernel bridge globals, window.demo, or sibling node_modules/.runtime.
import {
  Runtime,
  SessionClient,
  checkEndpointHealth,
  startServer,
  type ChatEvent,
  type ChatUnsubscribe,
  type EndpointHandle,
  type OpenCodeServer,
  type Runtime as RuntimeT,
  type SessionInfo,
} from "./opencode-stub";

const $ = <T extends HTMLElement>(id: string) =>
  document.querySelector<T>(`#${id}`)!;

const statusEl = $("status");
const endpointEl = $("endpoint");
const logsEl = $("logs");
const sessionsEl = $("sessions") as unknown as HTMLSelectElement;
const titleEl = $("title") as unknown as HTMLInputElement;
const promptEl = $("prompt") as unknown as HTMLTextAreaElement;
const transcriptEl = $("transcript");

function log(s: string) {
  logsEl.textContent += s + "\n";
}
function status(s: string) {
  statusEl.textContent = s;
  log(new Date().toISOString() + " " + s);
}

let runtime: RuntimeT | undefined;
let server: OpenCodeServer | undefined;
let endpoint: EndpointHandle | undefined;
let client: SessionClient | undefined;
let sessions: SessionInfo[] = [];
let currentID: string | undefined;
let unsubscribe: ChatUnsubscribe | undefined;
let sendAbort: AbortController | undefined;

function setButtons() {
  const up = !!server;
  ($("start-server") as HTMLButtonElement).disabled = up;
  ($("stop-server") as HTMLButtonElement).disabled = !up;
  ($("health") as HTMLButtonElement).disabled = !up;
  ($("refresh") as HTMLButtonElement).disabled = !up;
  ($("create") as HTMLButtonElement).disabled = !up;
  ($("send") as HTMLButtonElement).disabled = !up || !currentID;
  ($("abort") as HTMLButtonElement).disabled = !sendAbort;
}

function renderSessions() {
  sessionsEl.innerHTML = "";
  for (const s of sessions) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.title ? `${s.title} (${s.id})` : s.id;
    if (s.id === currentID) opt.selected = true;
    sessionsEl.appendChild(opt);
  }
  setButtons();
}

function onEvent(e: ChatEvent) {
  if (e.sessionID !== currentID) return;
  if (e.type === "text") transcriptEl.textContent += e.delta;
  else if (e.type === "done") {
    log("stream done");
    sendAbort = undefined;
    setButtons();
  } else if (e.type === "error") {
    log("stream error: " + e.message);
    sendAbort = undefined;
    setButtons();
  }
}

$("start-server").onclick = async () => {
  try {
    status("Starting runtime + OpenCode server…");
    runtime = await Runtime.start({});
    server = await startServer(runtime, { projectRoot: "/workspace", port: 4106 });
    endpoint = server.endpoint;
    endpointEl.textContent = endpoint.url;
    client = new SessionClient(endpoint);
    status("Server started at " + endpoint.url);
    setButtons();
  } catch (e) {
    status("Start failed: " + String(e));
  }
};

$("stop-server").onclick = async () => {
  try {
    unsubscribe?.();
    unsubscribe = undefined;
    sendAbort?.abort();
    sendAbort = undefined;
    await server?.stop();
    endpoint?.close();
    await runtime?.stop().catch(() => {});
    server = endpoint = client = runtime = undefined;
    sessions = [];
    currentID = undefined;
    endpointEl.textContent = "—";
    renderSessions();
    status("Server stopped. Durable workspace state preserved; restart reattaches.");
  } catch (e) {
    log(String(e));
  }
};

$("health").onclick = async () => {
  try {
    if (!endpoint) throw new Error("server not started");
    await checkEndpointHealth(endpoint);
    status("Endpoint healthy: " + endpoint.url);
  } catch (e) {
    status("Health check failed: " + String(e));
  }
};

$("refresh").onclick = async () => {
  try {
    if (!client) throw new Error("server not started");
    sessions = await client.list();
    if (!sessions.some((s) => s.id === currentID)) currentID = sessions[0]?.id;
    transcriptEl.textContent = "";
    renderSessions();
    log(`listed ${sessions.length} session(s)`);
  } catch (e) {
    log(String(e));
  }
};

$("create").onclick = async () => {
  try {
    if (!client) throw new Error("server not started");
    const s = await client.create({ title: titleEl.value || undefined });
    sessions.push(s);
    currentID = s.id;
    transcriptEl.textContent = "";
    renderSessions();
    log("created session " + s.id);
  } catch (e) {
    log(String(e));
  }
};

sessionsEl.onchange = () => {
  unsubscribe?.();
  unsubscribe = undefined;
  currentID = sessionsEl.value || undefined;
  transcriptEl.textContent = "";
  if (client && currentID) unsubscribe = client.subscribe(currentID, onEvent);
  setButtons();
};

$("send").onclick = async () => {
  try {
    if (!client || !currentID) throw new Error("select a session first");
    const prompt = promptEl.value;
    if (!prompt.trim()) return;
    sendAbort?.abort();
    sendAbort = new AbortController();
    unsubscribe?.();
    unsubscribe = client.subscribe(currentID, onEvent);
    transcriptEl.textContent += `\n> ${prompt}\n`;
    promptEl.value = "";
    setButtons();
    await client.send(currentID, prompt, sendAbort.signal);
  } catch (e) {
    log(String(e));
    sendAbort = undefined;
    setButtons();
  }
};

$("abort").onclick = async () => {
  try {
    sendAbort?.abort();
    sendAbort = undefined;
    if (client && currentID) await client.abort(currentID);
    log("aborted session " + (currentID ?? ""));
  } catch (e) {
    log(String(e));
  } finally {
    setButtons();
  }
};

setButtons();
