import { bundle, root, styles } from "./build";
import { resolve, sep } from "node:path";
import { modelProxy } from "../vivari/scripts/model-proxy";
import catalog from "../vivari/src/provider-upstreams.json";
import { checkAssets, runtimeRoot, preparedRoot } from "./setup";
const proxy = modelProxy(new Map([["opencode", { baseURL: catalog.upstreams.opencode, headers: { authorization: "Bearer public" } }]]));

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
    try {
      if (path.startsWith("/api/model/")) return proxy(request);
      if (path === "/demo-info") return Response.json({ name: "workspace-react-demo", root, runtimeRoot, preparedRoot }, { headers });
      if (path === "/setup-check") {
        const result = await checkAssets();
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
      return new Response("Not found", { status: 404, headers });
    } catch (error) { console.error(error); return new Response(String(error), { status: 500, headers }); }
  },
}); } catch (error) {
  if ((error as { code?: string }).code === "EADDRINUSE") throw Error(`Port ${process.env.PORT ?? 4311} is already in use. Stop its owning terminal or use PORT=4312 bun run demo. No existing process was stopped.`);
  throw error;
} }
const server = serve();
console.log(`Workspace React demo + local model proxy: ${server.url}\nOpen the URL and click Start workspace. Ctrl-C stops this server.`);
const stop = () => { server.stop(true); process.exit(0); };
process.once("SIGINT", stop); process.once("SIGTERM", stop);
const setup = await checkAssets();
if (!setup.ok) console.error(`Sample setup required: ${setup.message}`);
