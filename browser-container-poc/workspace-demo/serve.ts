import { bundle, root } from "./build";
import { resolve, sep } from "node:path";
import { modelProxy } from "../vivari/scripts/model-proxy";
import catalog from "../vivari/src/provider-upstreams.json";
const proxy = modelProxy(new Map([["opencode", { baseURL: catalog.upstreams.opencode, headers: { authorization: "Bearer public" } }]]));

const headers = {
  "Cache-Control": "no-store",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Service-Worker-Allowed": "/",
};
const runtimeRoot = resolve(process.env.RUNTIME_DIR ?? `${root}/../workspace-api/dist/runtime`);
const preparedRoot = resolve(process.env.PREPARED_DIR ?? `${root}/dist/prepared`);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 4310),
  idleTimeout: 240,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    try {
      if (path.startsWith("/api/model/")) return proxy(request);
      if (path === "/" || path === "/index.html") return new Response(Bun.file(`${root}/index.html`), { headers });
      if (path === "/app.js") return new Response(await bundle(), { headers: { ...headers, "Content-Type": "text/javascript" } });
      for (const [prefix, directory] of [["/runtime/", runtimeRoot], ["/prepared/", preparedRoot]] as const) {
        if (!path.startsWith(prefix)) continue;
        const filePath = resolve(directory, decodeURIComponent(path.slice(prefix.length)));
        if (filePath.startsWith(directory + sep) && await Bun.file(filePath).exists()) return new Response(Bun.file(filePath), { headers });
      }
      return new Response("Not found", { status: 404, headers });
    } catch (error) { console.error(error); return new Response(String(error), { status: 500, headers }); }
  },
});
console.log(`Workspace demo: ${server.url}`);
