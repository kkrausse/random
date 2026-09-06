// Only /__guest/ documents are controlled; their same-origin assets go to the VM.
const failure = (message, status) => new Response(message, { status, headers: {
  "Content-Type": "text/plain; charset=utf-8",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
} });
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname === "/preview-websocket.js") return;
  event.respondWith((async () => {
    if (!["GET", "HEAD"].includes(event.request.method)) return failure("This preview bridge supports GET and HEAD", 405);
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const owner = clients.find((client) => client.url === `${url.origin}/`);
    if (!owner) return failure("Workspace is not open", 503);
    const channel = new MessageChannel();
    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => { channel.port1.close(); resolve({ error: "Guest request timed out" }); }, 300_000);
      channel.port1.onmessage = ({ data }) => { clearTimeout(timer); channel.port1.close(); resolve(data); };
      owner.postMessage({ source: "guest-http", request: {
        type: "http", method: event.request.method,
        path: url.pathname.replace(/^\/__guest(?=\/)/, "") + url.search,
        accept: event.request.headers.get("accept"),
      } }, [channel.port2]);
    });
    if (result.error) return failure(result.error, 502);
    const compressed = Uint8Array.from(atob(result.body), (char) => char.charCodeAt(0));
    let body = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    const headers = new Headers(result.headers);
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    headers.set("Cross-Origin-Resource-Policy", "same-origin");
    headers.set("Cache-Control", "no-store");
    if (headers.get("content-type")?.includes("text/html")) {
      body = new TextEncoder().encode(new TextDecoder().decode(body).replace("<head>",
        '<head><script src="/preview-websocket.js"></script>')).buffer;
    }
    return new Response([204, 205, 304].includes(result.status) ? null : body, { status: result.status, headers });
  })().catch((error) => failure(String(error), 502)));
});
