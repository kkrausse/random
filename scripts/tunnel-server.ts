// Static server behind the opentunnel route (see setup-opentunnel.sh). The
// opentunnel client terminates TLS on this machine and forwards plaintext here,
// so this listens on loopback only and serves nothing but the tunnel shelf.
import { mkdir, realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";

const root = process.env.DEPLOY_TUNNEL_ROOT ?? join(process.env.HOME!, "devfs/tunnel-artifacts");
await mkdir(join(root, "artifacts"), { recursive: true });
const shelf = await realpath(join(root, "artifacts"));
const port = Number(process.env.TUNNEL_SERVER_PORT ?? 8081);
const headers = { "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };

const reply = (status: number, extra: Record<string, string> = {}) =>
  new Response(null, { status, headers: { ...headers, ...extra } });

Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") return reply(405);
    const url = new URL(request.url);
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return reply(400);
    }
    if (pathname === "/") return reply(302, { Location: "/artifacts/" });
    // Dot segments cover both traversal and bookkeeping files like .published-at.
    if (!pathname.startsWith("/artifacts/") || pathname.includes("\0")
      || pathname.split("/").some((part) => part.startsWith("."))) return reply(404);
    try {
      let target = join(shelf, pathname.slice("/artifacts/".length));
      if ((await stat(target)).isDirectory()) {
        if (!pathname.endsWith("/")) return reply(301, { Location: url.pathname + "/" });
        target = join(target, "index.html");
      }
      // Resolve symlinks so a link inside an artifact cannot reach outside the shelf.
      const real = await realpath(target);
      if (real !== shelf && !real.startsWith(shelf + sep)) return reply(404);
      return new Response(Bun.file(real), { headers });
    } catch {
      return reply(404);
    }
  },
});
console.log(`tunnel shelf ${shelf} on http://127.0.0.1:${port}`);
