// Opt-in through workspace-api's real Node/Rust worker harness. Never a host app server.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Runtime, type Workspace, type Distribution, type Execution } from "../../workspace-api/src/index";
import { loadPrepared, preparedApps, openCodeLaunch, waitForOpenCode } from "../src/prepared";
import { OpenCodeAPI } from "../../opencode-client-demo/src/api";

export async function testPreparedApps({ workspace, distribution, kernel }: {
  workspace: Workspace; distribution: Distribution;
  kernel: { mkdirp(path: string): void; writeFile(path: string, text: string): void; procs: Map<unknown, unknown>; listeners: Map<unknown, unknown>;
    onWsSend: ((message: { sub: string; data?: string }) => void) | null;
    handleWsClient(message: Record<string, unknown>): void;
  };
}) {
  const directory = resolve(process.env.PREPARED_APPS!);
  const catalog = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../vivari/src/provider-upstreams.json"), "utf8"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "prepared.invalid") {
      const name = url.pathname.slice(1);
      if (!/^(manifest\.json|[a-f0-9]{64}\.bin)$/.test(name)) throw Error("Invalid test asset path");
      return new Response(readFileSync(resolve(directory, name)));
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  let runtime: Runtime | undefined;
  const drains: Promise<void>[] = [];
  function drain(execution: Execution, label: string) {
    for (const [channel, stream] of [["stdout", execution.stdout], ["stderr", execution.stderr]] as const) {
      drains.push((async () => { for await (const chunk of stream) console.log(`[${label}:${channel}] ${new TextDecoder().decode(chunk)}`); })());
    }
  }
  try {
    const manifest = await loadPrepared("http://prepared.invalid/");
    console.log(`Prepared distribution ${manifest.runtimeVersion}, OpenCode ${manifest.openCodeVersion}`);
    const apps = await Runtime.start({ workspace, distribution, tools: { apps: preparedApps(manifest, console.log, "http://prepared.invalid/") } });
    runtime = apps;
    await apps.tools.apps();
    for (const [path, content] of Object.entries(manifest.project)) {
      const destination = "/workspace" + path;
      kernel.mkdirp(destination.slice(0, destination.lastIndexOf("/")));
      kernel.writeFile(destination, content.replaceAll("__MODEL_PROXY__", catalog.upstreams.opencode));
    }
    const vite = await runtime.node(manifest.vite); drain(vite, "Vite");
    const preview = await runtime.expose(5173, { signal: AbortSignal.timeout(30000) });
    const html = await preview.fetch("/", { signal: AbortSignal.timeout(15000) });
    assert.equal(html.status, 200); assert.match(await html.text(), /@vite\/client/);
    assert.equal((await preview.fetch("/src/main.tsx")).status, 200);
    const clientSource = await (await preview.fetch("/@vite/client")).text();
    const token = /const wsToken = "([^"]+)"/.exec(clientSource)?.[1];
    assert.ok(token, "Actual Vite client carries websocket token");
    const frames: string[] = [];
    kernel.onWsSend = message => { if (message.sub === "msg" && message.data) frames.push(message.data); };
    kernel.handleWsClient({ sub: "open", connId: "prepared-vite-hmr", port: 5173, path: "/?token=" + encodeURIComponent(token), protocols: ["vite-hmr"] });
    const waitFor = async (predicate: () => boolean) => {
      const until = Date.now() + 10000;
      while (!predicate() && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 50));
      assert.ok(predicate(), "Expected actual Vite websocket frame");
    };
    await waitFor(() => frames.some(frame => frame.includes('"type":"connected"')));
    const app = await preview.fetch("/src/App.tsx", { signal: AbortSignal.timeout(15000) });
    assert.equal(app.status, 200); assert.match(await app.text(), /Hello from real Vite/);
    kernel.writeFile("/workspace/src/App.tsx", 'import React from "react"; export default function App(){return <h1>Edited through shared VFS</h1>}');
    const edited = await preview.fetch("/src/App.tsx?t=1", { signal: AbortSignal.timeout(15000) });
    assert.equal(edited.status, 200); assert.match(await edited.text(), /Edited through shared VFS/);
    await waitFor(() => frames.some(frame => frame.includes('"type":"update"')));
    console.log("PASS real Vite HMR websocket update over kernel tunnel (iframe Document still unverified)");
    console.log("PASS actual guest Vite HTML + TSX transformation + edited shared source (no browser HMR claim)");
    const connection = openCodeLaunch(manifest.opencode);
    const server = await runtime.node(connection.options); drain(server, "OpenCode");
    const endpoint = await runtime.expose(4096, { signal: AbortSignal.timeout(60000) });
    console.log("Guest health", await waitForOpenCode(endpoint, connection.headers));
    const api = new OpenCodeAPI({ url: endpoint.url, fetch: (async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("authorization", connection.headers.authorization);
      return endpoint.fetch(String(input), { ...init, headers });
    }) as typeof fetch });
    const models = await api.models(AbortSignal.timeout(15000));
    assert.ok(Array.isArray(models));
    const session = await api.create("Prepared worker integration", AbortSignal.timeout(15000));
    const id = session.id; assert.ok(id);
    assert.ok((await api.list()).some(s => s.id === id));
    await api.history(id);
    const events = await endpoint.fetch("/api/event", { headers: connection.headers, signal: AbortSignal.timeout(15000) });
    assert.equal(events.status, 200);
    const reader = events.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /server.connected/);
    await reader.cancel();
    await api.interrupt(id);
    console.log("PASS guest OpenCode health/models/session/history/live SSE + cancellation/interrupt");
    const model = models.find(m => m.providerID === "opencode" && m.id === "muse-spark-1.3-contributor-free");
    assert.ok(model, "Prepared free model is available after catalog activation");
    await api.model(id, { providerID: model.providerID, id: model.id });
    // The browser reloads modules after Vite's first dependency optimization.
    // Re-establish that graph before asking the model to edit its child module.
    await (await preview.fetch("/src/main.tsx")).text();
    await (await preview.fetch("/src/App.tsx")).text();
    frames.length = 0;
    const subscription = new AbortController();
    const eventTypes: string[] = [];
    let ready!: () => void;
    const connected = new Promise<void>(resolve => { ready = resolve; });
    let terminal = false;
    let providerError: unknown;
    const live = api.events(subscription.signal, ready, event => {
      if (event.data.sessionID !== id) return;
      eventTypes.push(event.type);
      if (/^session\.execution\.(succeeded|failed|interrupted)$/.test(event.type)) terminal = true;
      if (event.data.error) providerError = event.data.error;
    });
    // Attach a rejection handler immediately; transport failure is always a test failure.
    let streamError: unknown;
    const streamed = live.catch(error => { if (!subscription.signal.aborted) streamError = error; });
    await Promise.race([connected, new Promise<never>((_, reject) => setTimeout(() => reject(Error("Client SSE ready timeout")), 15000).unref())]);
    try {
      await api.prompt(id, 'Edit only /workspace/src/App.tsx so its heading reads "Prepared OpenCode edit". Use read/edit tools, no shell and no delegation. Keep the React component valid. Then stop.', AbortSignal.timeout(30000));
      const until = Date.now() + 60000;
      while (!terminal && !providerError && !streamError && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 100));
      await api.interrupt(id, AbortSignal.timeout(10000));
      assert.equal(streamError, undefined);
      const history = await api.history(id, AbortSignal.timeout(15000));
      assert.ok(history.some(message => message.type === "user"), "Prompt promoted into real durable history");
      console.log("PASS actual chat adapter model selection, prompt admission/history, live events, interrupt", [...new Set(eventTypes)]);
      const result = await preview.fetch("/src/App.tsx?t=2", { signal: AbortSignal.timeout(15000) });
      const changed = (await result.text()).includes("Prepared OpenCode edit");
      console.log(changed ? "PASS real provider edit reached Vite transformed source" : "PROVIDER GATE INCOMPLETE: no verified model edit", { terminal, providerError });
      if (changed) {
        await waitFor(() => frames.some(frame => frame.includes('"type":"update"')));
        console.log("PASS model edit generated actual Vite HMR update frame");
      }
      const beforeCancel = eventTypes.length;
      await api.prompt(id, "Explain how HTTP streaming works in detail. Do not edit files or delegate.", AbortSignal.timeout(15000));
      await waitFor(() => eventTypes.slice(beforeCancel).includes("session.execution.started"));
      await api.interrupt(id, AbortSignal.timeout(15000));
      await waitFor(() => eventTypes.slice(beforeCancel).includes("session.execution.interrupted"));
      console.log("PASS interrupt cancels an actively running prompt through the real client adapter");
    } finally { subscription.abort(); await streamed; }
    await runtime.stop(); runtime = undefined;
    await Promise.all(drains);
    assert.equal(kernel.procs.size, 0); assert.equal(kernel.listeners.size, 0);
    runtime = await Runtime.start({ workspace, distribution });
    const again = await runtime.node(manifest.vite); drain(again, "Vite restart");
    const restarted = await runtime.expose(5173, { signal: AbortSignal.timeout(30000) });
    assert.equal((await restarted.fetch("/")).status, 200);
    const serverAgain = await runtime.node(connection.options); drain(serverAgain, "OpenCode restart");
    const endpointAgain = await runtime.expose(4096, { signal: AbortSignal.timeout(60000) });
    await waitForOpenCode(endpointAgain, connection.headers);
    const historyAgain = await endpointAgain.fetch(`/api/session/${id}/message`, { headers: connection.headers, signal: AbortSignal.timeout(15000) });
    assert.equal(historyAgain.status, 200);
    assert.ok((await historyAgain.json()).data.some((message: { type: string }) => message.type === "user"));
    console.log("PASS stop cleans all processes/ports; Vite + OpenCode restart with session history retained");
  } finally {
    await runtime?.stop(); await Promise.allSettled(drains); globalThis.fetch = originalFetch;
  }
}
