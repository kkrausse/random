// Opt-in through workspace-api's real Node/Rust worker harness. Never a host app server.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Runtime, type Workspace, type Distribution, type Execution } from "@vivari/workspace-api";
import { loadPrepared, preparedApps, openCodeLaunch, waitForOpenCode } from "../src/prepared";
import { createChatController, type ChatController } from "@vivari/opencode-chat";

export async function testPreparedApps({ workspace, distribution, kernel, restore = false, flush }: {
  workspace: Workspace; distribution: Distribution;
  restore?: boolean; flush(): Promise<void>;
  kernel: { mkdirp(path: string): void; writeFile(path: string, text: string): void; readFile(path: string): string; exists(path: string): boolean; procs: Map<unknown, unknown>; listeners: Map<unknown, unknown>;
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
  let chat: ChatController | undefined;
  const drains: Promise<void>[] = [];
  function drain(execution: Execution, label: string) {
    for (const [channel, stream] of [["stdout", execution.stdout], ["stderr", execution.stderr]] as const) {
      drains.push((async () => { let bytes = 0; for await (const chunk of stream) bytes += chunk.length; console.log(`[${label}:${channel}] drained ${bytes} bytes`); })());
    }
  }
  try {
    const manifest = await loadPrepared("http://prepared.invalid/");
    console.log(`Prepared distribution ${manifest.runtimeVersion}, OpenCode ${manifest.openCodeVersion}`);
    const saved = restore ? JSON.parse(kernel.readFile("/workspace/.integration-session.json")) as { id: string; source: string } : undefined;
    if (saved) {
      assert.equal(kernel.readFile("/workspace/src/App.tsx"), saved.source, "Fresh FS worker restored exact edited source");
      assert.ok(!kernel.exists("/workspace/node_modules"), "Dependencies are excluded from durable snapshots");
      assert.ok(!kernel.exists("/opencode-v2"), "Prepared OpenCode must be explicitly restored");
      console.log("PASS fresh FS worker restored source with both prepared dependency trees absent (test-only disk persistence)");
    }
    const apps = await Runtime.start({ workspace, distribution, tools: { apps: preparedApps(manifest, console.log, "http://prepared.invalid/") } });
    runtime = apps;
    await apps.tools.apps();
    if (saved) {
      const vite = await runtime.node(manifest.vite); drain(vite, "Vite fresh worker");
      const preview = await runtime.expose(5173, { signal: AbortSignal.timeout(30000) });
      assert.equal((await preview.fetch("/")).status, 200);
      const transformed = await preview.fetch("/src/App.tsx");
      assert.equal(transformed.status, 200);
      assert.match(await transformed.text(), /Prepared OpenCode edit|Edited through shared VFS/);
      const connection = openCodeLaunch(manifest.opencode);
      const server = await runtime.node(connection.options); drain(server, "OpenCode fresh worker");
      const endpoint = await runtime.expose(4096, { signal: AbortSignal.timeout(60000) });
      await waitForOpenCode(endpoint, connection.headers);
      const history = await endpoint.fetch(`/api/session/${saved.id}/message`, { headers: connection.headers });
      assert.equal(history.status, 200);
      assert.ok((await history.json()).data.some((message: { type: string }) => message.type === "user"));
      console.log("PASS fresh FS/process workers: explicit dependency restoration, Vite transformed retained source, authenticated OpenCode retained session history");
      return;
    }
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
    assert.equal(app.status, 200); assert.match(await app.text(), /My browser counter/);
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
    const api = createChatController({ directory: "/workspace", endpoint: { url: endpoint.url, fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("authorization", connection.headers.authorization);
      return endpoint.fetch(input, { ...init, headers });
    } } });
    chat = api;
    await api.ready;
    const models = api.getSnapshot().models;
    assert.ok(Array.isArray(models));
    const id = await api.createSession("Prepared worker integration"); assert.ok(id);
    assert.ok(api.getSnapshot().sessions.some(s => s.id === id));
    assert.equal(api.getSnapshot().connection, "connected");
    console.log("PASS public controller guest health/models/session/history and live SSE handshake");
    const model = models.find(m => m.providerID === "opencode" && m.id === "muse-spark-1.3-contributor-free");
    assert.ok(model, "Prepared free model is available after catalog activation");
    await api.selectModel({ providerID: model.providerID, id: model.id });
    // The browser reloads modules after Vite's first dependency optimization.
    // Re-establish that graph before asking the model to edit its child module.
    await (await preview.fetch("/src/main.tsx")).text();
    await (await preview.fetch("/src/App.tsx")).text();
    frames.length = 0;
    let terminal = false;
    let providerError: unknown;
    let changed = false;
    let sawRunning = false;
    const observations = new Set<string>();
    const unsubscribe = api.subscribe(() => {
      const snapshot = api.getSnapshot();
      observations.add(snapshot.execution);
      if (snapshot.execution === "running" || snapshot.execution === "retrying") sawRunning = true;
      terminal = sawRunning && snapshot.execution === "idle";
      if (snapshot.error) providerError = snapshot.error;
    });
    try {
      await api.send({ text: 'Edit only /workspace/src/App.tsx so its heading reads "Prepared OpenCode edit". Use read/edit tools, no shell and no delegation. Keep the React component valid. Then stop.' });
      const until = Date.now() + 60000;
      while (!terminal && !providerError && api.getSnapshot().connection === "connected" && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(api.getSnapshot().connection, "connected", "Stream disconnect is not provider success");
      if (!terminal) { await api.interrupt(); await waitFor(() => api.getSnapshot().execution === "idle"); }
      await api.reconnect();
      const history = api.getSnapshot().messages;
      assert.ok(history.some(message => message.type === "user"), "Prompt promoted into real durable history");
      console.log("PASS public controller model selection, prompt admission/history and execution states", [...observations]);
      const result = await preview.fetch("/src/App.tsx?t=2", { signal: AbortSignal.timeout(15000) });
      changed = (await result.text()).includes("Prepared OpenCode edit");
      console.log(changed ? "PASS real provider edit reached Vite transformed source" : "PROVIDER GATE INCOMPLETE: no verified model edit", { terminal, providerError });
      if (changed) {
        await waitFor(() => frames.some(frame => frame.includes('"type":"update"')));
        console.log("PASS model edit generated actual Vite HMR update frame");
      }
      await api.send({ text: "Explain how HTTP streaming works in detail. Do not edit files or delegate." });
      await waitFor(() => api.getSnapshot().execution === "running");
      await api.interrupt();
      await waitFor(() => api.getSnapshot().execution === "idle" && !api.getSnapshot().interruptRequested);
      console.log("PASS active interrupt reaches authoritative idle through the public controller");
    } finally { unsubscribe(); api.dispose(); chat = undefined; }
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
    await runtime.stop(); runtime = undefined;
    kernel.writeFile("/workspace/.integration-session.json", JSON.stringify({ id, source: kernel.readFile("/workspace/src/App.tsx") }));
    await flush();
    console.log("PASS explicit disk snapshot flush; ready for APP_RESTORE=1 in a fresh Node/FS worker");
    assert.ok(changed, `Real provider edit is required for app acceptance: ${JSON.stringify(providerError ?? "no edit observed")}`);
  } finally {
    chat?.dispose();
    await runtime?.stop(); await Promise.allSettled(drains); globalThis.fetch = originalFetch;
  }
}
