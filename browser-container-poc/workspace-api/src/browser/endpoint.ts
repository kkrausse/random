import type { Host } from "../host.js";
import { attachEndpointPreview } from "./preview.js";
import { WorkspaceError, type Endpoint, type Execution, type NodeLaunchOptions } from "../types.js";

// This ordinary guest module adapts real Node HTTP streams to the byte execution
// channel. Each request owns a process, hence abort closes the actual guest TCP
// connection. No preview buffering or EventSource substitution is involved.
const FETCH_ENTRY = "/tmp/workspace-api-http-v1.cjs";
const FETCH_SOURCE = `
const http = require('node:http');
const spec = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'));
const req = http.request({ hostname: '127.0.0.1', port: spec.port, path: spec.path, method: spec.method, headers: spec.headers }, res => {
  process.stdout.write(JSON.stringify({ status: res.statusCode, statusText: res.statusMessage, headers: res.headers }) + '\\n');
  res.on('data', chunk => process.stdout.write(chunk));
  res.on('error', error => { console.error(error.message); process.exitCode = 1; });
});
req.on('error', error => { console.error(error.message); process.exitCode = 1; });
req.end(Buffer.from(spec.body, 'base64'));
`;
function base64(bytes: Uint8Array): string {
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
}
type Launch = (options: NodeLaunchOptions, binding?: Record<string, unknown>) => Promise<Execution>;
export function createEndpoint(host: Host, port: number, listenerId: string, node: Launch): Endpoint {
  if (host.listeners.get(port) !== listenerId) throw new WorkspaceError("CLOSED", "Listener closed before endpoint attachment");
  let reason: string | undefined;
  let close!: (value: { reason: string }) => void;
  const closed = new Promise<{ reason: string }>(resolve => { close = resolve; });
  const lifetime = new AbortController();
  const check = () => {
    if (reason || host.listeners.get(port) !== listenerId) throw new WorkspaceError("CLOSED", reason ?? "Listener closed");
  };
  const dispose = (why = "Endpoint disposed") => {
    if (reason) return;
    reason = why; off(); lifetime.abort(new WorkspaceError("CLOSED", why)); close({ reason: why });
  };
  const off = host.on(m => {
    if (m.type === "host-error" || (m.type === "unlisten" && m.listenerId === listenerId) || (m.type === "listen" && m.port === port && m.listenerId !== listenerId)) dispose("Listener closed");
  });
  const endpoint: Endpoint = {
    url: new URL(`/preview/${port}/?__vv_listener=${encodeURIComponent(listenerId)}`, location.href).href,
    port, closed, dispose,
    attachPreview(iframe, options) { return attachEndpointPreview(iframe, endpoint, { host, check }, options); },
    async fetch(input, init = {}) {
      check();
      const signal = init.signal ? AbortSignal.any([init.signal, lifetime.signal]) : lifetime.signal;
      signal.throwIfAborted();
      const url = new URL(input, `http://workspace.invalid/`);
      if (url.origin !== "http://workspace.invalid" && url.origin !== new URL(endpoint.url).origin) throw new Error("Endpoint.fetch accepts relative paths or its own preview URL");
      let path = url.pathname + url.search;
      if (url.origin !== "http://workspace.invalid") {
        const prefix = `/preview/${port}/`;
        if (!url.pathname.startsWith(prefix)) throw new Error("URL belongs to another endpoint");
        url.searchParams.delete("__vv_listener");
        path = "/" + url.pathname.slice(prefix.length) + url.search;
      }
      const request = new Request("http://workspace.invalid" + path, { ...init, signal });
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length > 8 * 1024 * 1024) throw new RangeError("Endpoint upload exceeds 8 MiB");
      await host.request("workspace-write", { path: FETCH_ENTRY, bytes: FETCH_SOURCE });
      check(); signal.throwIfAborted();
      const spec = { port, path, method: request.method, headers: Object.fromEntries(request.headers), body: base64(bytes) };
      const execution = await node({ entry: FETCH_ENTRY, args: [base64(new TextEncoder().encode(JSON.stringify(spec)))], signal }, { listenerId, port });
      let diagnostics = "";
      const errors = (async () => { const decoder = new TextDecoder(); for await (const chunk of execution.stderr) diagnostics = (diagnostics + decoder.decode(chunk, { stream: true })).slice(-8192); })();
      const iterator = execution.stdout[Symbol.asyncIterator]();
      let header = new Uint8Array(0), first: Uint8Array | undefined;
      try {
        while (true) {
          const { value, done } = await iterator.next();
          if (done) { await errors; throw new Error(`HTTP relay ended before headers: ${diagnostics}`); }
          const newline = value.indexOf(10);
          const part = newline === -1 ? value : value.subarray(0, newline);
          if (header.length + part.length > 65536) throw new Error("HTTP response headers exceed 64 KiB");
          const next = new Uint8Array(header.length + part.length); next.set(header); next.set(part, header.length); header = next;
          if (newline !== -1) { first = value.subarray(newline + 1); break; }
        }
        const metadata = JSON.parse(new TextDecoder().decode(header)) as { status: number; statusText: string; headers: Record<string, string | string[]> };
        const headers = new Headers();
        for (const [name, value] of Object.entries(metadata.headers)) for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
        const body = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              signal.throwIfAborted();
              if (first?.length) { controller.enqueue(first); first = undefined; return; }
              const next = await iterator.next();
              if (next.done) {
                const result = await execution.exited; await errors;
                if (result.exitCode !== 0) throw new Error(`HTTP relay failed: ${diagnostics}`);
                controller.close();
              } else controller.enqueue(next.value);
            } catch (error) { controller.error(error); await execution.stop(); }
          },
          async cancel() { await execution.stop(); await iterator.return?.(); await errors; },
        }, { highWaterMark: 1 });
        if (request.method === "HEAD" || [204, 205, 304].includes(metadata.status)) {
          await body.cancel();
          return new Response(null, { status: metadata.status, statusText: metadata.statusText, headers });
        }
        return new Response(body, { status: metadata.status, statusText: metadata.statusText, headers });
      } catch (error) { await execution.stop(); await errors.catch(() => {}); throw error; }
    },
  };
  return endpoint;
}
