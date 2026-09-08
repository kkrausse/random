import { bundle, root } from "./build";
import { resolve, sep } from "node:path";

const headers = {
  "Cache-Control": "no-store",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Service-Worker-Allowed": "/",
};
const runtimeRoot = process.env.RUNTIME_DIR ? resolve(process.env.RUNTIME_DIR) : undefined;

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 4310),
  async fetch(request) {
    const path = new URL(request.url).pathname;
    try {
      if (path === "/" || path === "/index.html") return new Response(Bun.file(`${root}/index.html`), { headers });
      if (path === "/app.js") return new Response(await bundle(), { headers: { ...headers, "Content-Type": "text/javascript" } });
      if (runtimeRoot && path.startsWith("/runtime/")) {
        const filePath = resolve(runtimeRoot, decodeURIComponent(path.slice("/runtime/".length)));
        if (filePath.startsWith(runtimeRoot + sep) && await Bun.file(filePath).exists()) return new Response(Bun.file(filePath), { headers });
      }
      return new Response("Not found", { status: 404, headers });
    } catch (error) { console.error(error); return new Response(String(error), { status: 500, headers }); }
  },
});
console.log(`Workspace demo: ${server.url}`);
