import { OpenCodeAPI, type ClientEndpoint, type Message, type ModelInfo, type NativeEvent, type SessionInfo } from "./api";
import { createMockEndpoint } from "./mock";

export function mountOpenCodeClient(container: HTMLElement, options: { endpoint?: ClientEndpoint; mock?: boolean; directory?: string } = {}): { dispose(): void } {
  const root = document.createElement("section");
  // Shadow styles keep multiple mounts independent, with no stylesheet dependency.
  const ui = root.attachShadow({ mode: "open" });
  ui.innerHTML = `<style>:host{display:block;font:14px system-ui}section{display:grid;gap:10px;padding:12px;border:1px solid #aaa}header,nav,form{display:flex;gap:8px;flex-wrap:wrap}button,input,select,textarea{font:inherit;padding:6px}select,textarea{max-width:100%}textarea{width:100%;min-height:70px;box-sizing:border-box}article{white-space:pre-wrap;overflow-wrap:anywhere;border-bottom:1px solid #ddd;padding:8px}#messages{max-height:420px;overflow:auto;min-height:100px}#error{color:#b42318;white-space:pre-wrap}p{margin:0}</style>
    <section aria-label="OpenCode chat"><header><strong>OpenCode 2</strong><span id="mode"></span><button id="connect">Reconnect / refresh</button></header><p id="status" role="status"></p><p id="error" role="alert"></p><button id="clear">Clear error</button><nav><label>Session <select id="sessions"></select></label><input id="title" aria-label="New session title" placeholder="Session title"><button id="create">New session</button></nav><label>Model <select id="models"></select></label><div id="messages" role="log" aria-label="Message history"></div><form><textarea id="prompt" aria-label="Message" placeholder="Message OpenCode"></textarea><button id="send" type="submit">Send</button><button id="abort" type="button">Abort execution</button></form></section>`;
  container.append(root);
  const $ = <T extends HTMLElement>(id: string) => ui.getElementById(id) as T;
  const sessionsEl = $<HTMLSelectElement>("sessions"), modelsEl = $<HTMLSelectElement>("models"), promptEl = $<HTMLTextAreaElement>("prompt");
  const endpoint = options.mock ? createMockEndpoint() : options.endpoint;
  const api = endpoint && new OpenCodeAPI(endpoint, options.directory);
  $("mode").textContent = options.mock ? "MOCK — in-memory fixtures" : endpoint ? `Browser endpoint: ${endpoint.url}` : "No browser endpoint supplied";
  let disposed = false, connected = false, busy = false, loading = false, current = "", generation = 0;
  let sessions: SessionInfo[] = [], models: ModelInfo[] = [], messages: Message[] = [];
  let connection = new AbortController();
  let send: AbortController | undefined;
  const live = new Map<string, Map<number, string>>();
  const status = (text: string) => { $("status").textContent = text; };
  const error = (e: unknown) => { if (!disposed) $("error").textContent = e instanceof Error ? e.message : String(e); };
  function buttons() {
    for (const id of ["create", "send"]) $<HTMLButtonElement>(id).disabled = !connected || busy || loading || (id === "send" && !current);
    $<HTMLButtonElement>("abort").disabled = !current || !api;
    sessionsEl.disabled = busy || loading;
    modelsEl.disabled = !connected || busy || loading;
  }
  function render() {
    const output = $("messages"); output.replaceChildren();
    for (const message of messages) {
      const article = document.createElement("article");
      const label = document.createElement("strong"); label.textContent = `${message.type}\n`;
      const text = message.text ?? message.content?.map(part => part.text ?? `[${part.type}${part.name ? `: ${part.name}` : ""}]`).join("\n") ?? `[${message.type}]`;
      article.append(label, document.createTextNode(text + (message.error ? `\n${JSON.stringify(message.error)}` : ""))); output.append(article);
    }
    output.scrollTop = output.scrollHeight;
  }
  async function history() {
    const id = current, version = ++generation;
    if (!api || !id) { messages = []; render(); return; }
    const result = await api.history(id, connection.signal);
    if (disposed || id !== current || version !== generation) return;
    messages = result;
    for (const [messageID, parts] of live) {
      let message = messages.find(m => m.id === messageID);
      if (!message) { message = { id: messageID, type: "assistant", content: [] }; messages.push(message); }
      for (const [ordinal, text] of parts) { message.content ??= []; message.content[ordinal] = { type: "text", text }; }
    }
    render();
  }
  function event(e: NativeEvent) {
    if (e.data.sessionID !== current) return;
    const d = e.data;
    if ((e.type === "session.text.delta" || e.type === "session.text.ended") && d.assistantMessageID) {
      const parts = live.get(d.assistantMessageID) ?? new Map<number, string>(); live.set(d.assistantMessageID, parts);
      const ordinal = d.ordinal ?? 0;
      parts.set(ordinal, e.type.endsWith("ended") ? d.text ?? "" : (parts.get(ordinal) ?? "") + (d.delta ?? ""));
      let message = messages.find(m => m.id === d.assistantMessageID);
      if (!message) { message = { id: d.assistantMessageID, type: "assistant", content: [] }; messages.push(message); }
      message.content ??= []; message.content[ordinal] = { type: "text", text: parts.get(ordinal)! }; render();
    }
    if (e.type === "session.execution.started") { busy = true; status("Running…"); }
    if (/^session\.execution\.(succeeded|failed|interrupted)$/.test(e.type)) {
      busy = false; status(e.type.split(".").at(-1)!);
      if (d.error) error(JSON.stringify(d.error));
      void history().catch(error);
    }
    buttons();
  }
  const run = (action: () => Promise<void>) => { void action().catch(e => { if (!disposed && !(e instanceof DOMException && e.name === "AbortError")) error(e); }).finally(buttons); };
  async function connect() {
    if (!api) return;
    connection.abort(); connection = new AbortController(); const controller = connection;
    connected = false; busy = false; loading = true; status("Connecting…"); buttons();
    $("error").textContent = "";
    const handshake = setTimeout(() => { if (!connected && !controller.signal.aborted) { controller.abort(); status("Disconnected — event handshake timed out"); error("No server.connected marker received. Check the browser endpoint and reconnect."); buttons(); } }, 15000);
    controller.signal.addEventListener("abort", () => clearTimeout(handshake), { once: true });
    const stream = api.events(controller.signal, () => { if (controller !== connection) return; clearTimeout(handshake); connected = true; status(options.mock ? "Connected to fixture" : "Connected to browser server"); buttons(); }, e => { if (controller === connection && !controller.signal.aborted) event(e); });
    void stream.catch(e => { clearTimeout(handshake); if (controller.signal.aborted) return; connected = false; busy = false; error(e); status("Disconnected — reconnect to recover history"); buttons(); });
    try {
      [sessions, models] = await Promise.all([api.list(controller.signal), api.models(controller.signal)]);
      if (controller !== connection || disposed) return;
      if (!sessions.some(s => s.id === current)) current = sessions[0]?.id ?? "";
      sessionsEl.replaceChildren(...sessions.map(s => new Option(s.title || s.id, s.id, false, s.id === current)));
      const model = sessions.find(s => s.id === current)?.model;
      modelsEl.replaceChildren(new Option("Server default", ""), ...models.filter(m => m.enabled).map(m => new Option(`${m.name} (${m.providerID})`, JSON.stringify({ providerID: m.providerID, id: m.id }), false, m.providerID === model?.providerID && m.id === model?.id)));
      live.clear(); await history();
    } catch (e) { if (controller === connection) { connected = false; controller.abort(); status("Connection failed — reconnect to retry"); } throw e; }
    finally { if (controller === connection) { loading = false; buttons(); } }
  }
  $("connect").onclick = () => run(connect);
  $("clear").onclick = () => { $("error").textContent = ""; };
  sessionsEl.onchange = () => run(async () => { current = sessionsEl.value; live.clear(); messages = []; render(); const model = sessions.find(s => s.id === current)?.model; modelsEl.value = model ? JSON.stringify(model) : ""; await history(); });
  $("create").onclick = () => run(async () => { loading = true; buttons(); try { const session = await api!.create($<HTMLInputElement>("title").value, connection.signal); current = session.id; await connect(); } finally { loading = false; } });
  ui.querySelector("form")!.onsubmit = e => {
    e.preventDefault(); if (!connected || busy || !current || !promptEl.value.trim()) return;
    run(async () => {
      const id = current, text = promptEl.value; busy = true; buttons(); send = new AbortController();
      const signal = AbortSignal.any([connection.signal, send.signal]);
      try {
        if (modelsEl.value) await api!.model(id, JSON.parse(modelsEl.value), signal);
        status("Sending…"); await api!.prompt(id, text, signal); promptEl.value = ""; await history();
      } catch (e) { busy = false; throw e; }
    });
  };
  $("abort").onclick = () => run(async () => { send?.abort(); await api!.interrupt(current, connection.signal); busy = false; status("Interrupt requested"); await history(); });
  status(api ? "Connecting…" : "Waiting for parent to supply an in-browser endpoint, or mount with mock: true."); buttons();
  if (api) run(connect);
  return { dispose() { disposed = true; generation++; connection.abort(); send?.abort(); root.remove(); } };
}
