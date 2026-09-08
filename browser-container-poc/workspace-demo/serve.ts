import { bundle, browserAssets, diagnosticBundle, root, styles } from "./build";
import { authorizeEditorRequest } from "@vivari/workspace-api/server";
import { authorizeEditing } from "./server-policy";
import { createBackend } from "./backend";
import { resolve, sep } from "node:path";
import { modelProxy } from "../vivari/scripts/model-proxy";
import catalog from "../vivari/src/provider-upstreams.json";
import { checkAssets, runtimeRoot, preparedRoot } from "./setup";
import { diagnosticLog } from "./diagnostic-log";
const diagnostics = diagnosticLog(`${root}/.diagnostics`);
const serverRun = crypto.randomUUID();
const proxy = modelProxy(new Map([["opencode", { baseURL: catalog.upstreams.opencode, headers: { authorization: "Bearer public" } }]]));
const backend = createBackend();

const headers = {
  "Cache-Control": "no-store",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Service-Worker-Allowed": "/",
};
function serve() { try { return Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 4311),
  idleTimeout: 240,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const started = performance.now();
    const record = (event: string, data: unknown) => { void diagnostics.write({ time: new Date().toISOString(), run: serverRun, event, data }); };
    try {
      if (path === "/editing-policy") return Response.json({ allowed: await authorizeEditing(request), fixture: "local admin; app-owned policy" }, { headers });
      if (path.startsWith("/assets/")) {
        const assets = await browserAssets();
        if (!assets.publicPaths.has(path)) { const denied = await authorizeEditorRequest(request, authorizeEditing); if (denied) return denied; }
        const contents = assets.files.get(path);
        return new Response(contents ?? "Not found", { status: contents ? 200 : 404, headers: { ...headers, "Content-Type": "text/javascript" } });
      }
      if (["/runtime/", "/prepared/", "/api/model/"].some(prefix => path.startsWith(prefix)) || ["/setup-check", "/diagnostics"].includes(path)) {
        const denied = await authorizeEditorRequest(request, authorizeEditing); if (denied) return denied;
      }
      const appResponse = await backend(request);
      if (appResponse) { for (const [key, value] of Object.entries(headers)) appResponse.headers.set(key, value); return appResponse; }
      if (path === "/diagnostics" && request.method === "POST") {
        if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return new Response("Origin mismatch", { status: 403, headers });
        const reader = request.body?.getReader();
        if (!reader) return new Response("Missing batch", { status: 400, headers });
        const chunks: Uint8Array[] = []; let size = 0;
        while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 128000) { await reader.cancel(); return new Response("Batch too large", { status: 413, headers }); } chunks.push(next.value); }
        let batch: unknown;
        try { batch = JSON.parse(await new Response(new Blob(chunks.map(chunk => new Uint8Array(chunk)))).text()); }
        catch { return new Response("Invalid JSON batch", { status: 400, headers }); }
        if (!Array.isArray(batch) || batch.length > 20) return new Response("Expected up to 20 events", { status: 400, headers });
        for (const entry of batch) await diagnostics.write({ received: new Date().toISOString(), serverRun, browser: entry });
        return new Response(null, { status: 204, headers });
      }
      if (path === "/diagnostics" && request.method === "GET") return new Response(await diagnostics.text(), { headers: { ...headers, "Content-Type": "application/x-ndjson", "Content-Disposition": "attachment; filename=workspace-diagnostics.jsonl" } });
      if (path === "/diagnostics.js") return new Response(await diagnosticBundle(), { headers: { ...headers, "Content-Type": "text/javascript" } });
      if (path.startsWith("/api/model/")) {
        const requestID = crypto.randomUUID();
        const response = await proxy(request);
        record("proxy.response", { requestID, status: response.status, elapsedMs: Math.round(performance.now() - started) });
        if (!response.body) return response;
        const reader = response.body.getReader(); let bytes = 0;
        return new Response(new ReadableStream({
          async pull(controller) {
            try {
              const next = await reader.read();
              if (next.done) { record("proxy.complete", { requestID, bytes, elapsedMs: Math.round(performance.now() - started) }); controller.close(); }
              else { bytes += next.value.length; controller.enqueue(next.value); }
            } catch (error) { record("proxy.stream.failed", { requestID, bytes, error, elapsedMs: Math.round(performance.now() - started) }); controller.error(error); }
          },
          async cancel() { record("proxy.cancelled", { requestID, bytes, elapsedMs: Math.round(performance.now() - started) }); await reader.cancel(); },
        }), { status: response.status, statusText: response.statusText, headers: response.headers });
      }
      if (path === "/demo-info") return Response.json({ name: "workspace-react-demo", root, runtimeRoot, preparedRoot, localEditorAdmin: process.env.LOCAL_EDITOR_ADMIN === "1" }, { headers });
      if (path === "/setup-check") {
        const result = await checkAssets();
        if (!result.ok) record("setup.failed", result);
        return Response.json(result, { status: result.ok ? 200 : 503, headers });
      }
      if (path === "/" || path === "/index.html") return new Response(Bun.file(`${root}/index.html`), { headers });
      if (path === "/app.js") return new Response(await bundle(), { headers: { ...headers, "Content-Type": "text/javascript" } });
      if (path === "/app.css") return new Response(await styles(), { headers: { ...headers, "Content-Type": "text/css" } });
      for (const [prefix, directory] of [["/runtime/", runtimeRoot], ["/prepared/", preparedRoot]] as const) {
        if (!path.startsWith(prefix)) continue;
        const filePath = resolve(directory, decodeURIComponent(path.slice(prefix.length)));
        if (filePath.startsWith(directory + sep) && await Bun.file(filePath).exists()) return new Response(Bun.file(filePath), { headers });
      }
      record("http.missing", { path, status: 404 });
      return new Response("Not found", { status: 404, headers });
    } catch (error) { if (path !== "/diagnostics") record("http.failed", { path, elapsedMs: Math.round(performance.now() - started), error }); return new Response("Request failed; see workspace-demo/.diagnostics/events.jsonl", { status: 500, headers }); }
  },
}); } catch (error) {
  if ((error as { code?: string }).code === "EADDRINUSE") throw Error(`Port ${process.env.PORT ?? 4311} is already in use. Stop its owning terminal or use PORT=4312 bun run demo. No existing process was stopped.`);
  throw error;
} }
const server = serve();
void diagnostics.write({ time: new Date().toISOString(), run: serverRun, event: "server.start", port: server.port });
console.log(`Local diagnostics: ${diagnostics.file} (download /diagnostics)`);
console.log(`Workspace React demo + local model proxy: ${server.url}\nNormal app is the default. LOCAL_EDITOR_ADMIN=1 exposes Enable editing. Ctrl-C stops this server.`);
const stop = () => { server.stop(true); process.exit(0); };
process.once("SIGINT", stop); process.once("SIGTERM", stop);
const setup = await checkAssets();
if (!setup.ok) console.error(`Sample setup required: ${setup.message}`);
