import { realpath } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { BlockList } from "node:net";
import { formats, listArchive, resolveArchive } from "./archive";
import { PicSyncAuth } from "./auth";
import { loadCredentials } from "./credentials";

const port = Number(process.env.PORT ?? 8789);
const publicUrl = process.env.PICSYNC_PUBLIC_URL;
const auth = new PicSyncAuth(port, publicUrl, await loadCredentials(port));

const root = await realpath(process.env.MEDIA_ROOT ?? "/home/pi/photos");
const modern = dirname(Bun.resolveSync("libraw-modern", import.meta.dir));
const assets = new Map<string, string>([
  ["/", join(import.meta.dir, "index.html")],
  ["/app.js", join(import.meta.dir, "dist/app.js")],
  ["/app.css", join(import.meta.dir, "dist/app.css")],
  ...[
    "strip-worker.js",
    "decode-strip.js",
    "strip-plan.js",
    "stitch-strips.js",
  ].map(
    (n) =>
      [`/${n}`, join(import.meta.dir, "../experiment", n)] as [string, string],
  ),
  ...["libraw.js", "libraw.wasm"].map(
    (n) => [`/modern/${n}`, join(modern, n)] as [string, string],
  ),
]);
const allowed = new BlockList();
const [network, prefix] = (process.env.LAN_CIDR ?? "127.0.0.0/8").split("/");
allowed.addSubnet(network!, Number(prefix), "ipv4");
const headers = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
};
const server = Bun.serve({
  hostname: process.env.HOST ?? "127.0.0.1",
  port,
  ...(process.env.TLS_CERT && process.env.TLS_KEY
    ? {
        tls: {
          cert: Bun.file(process.env.TLS_CERT),
          key: Bun.file(process.env.TLS_KEY),
        },
      }
    : {}),
  async fetch(request, server) {
    const peer = server.requestIP(request)?.address.replace(/^::ffff:/, "");
    if (!peer || !allowed.check(peer, "ipv4"))
      return new Response("LAN only", { status: 403, headers });
    const denied = await auth.guard(request, peer);
    if (denied) return denied;
    if (!["GET", "HEAD"].includes(request.method))
      return new Response(null, { status: 405, headers });
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/folder")
        return Response.json(
          await listArchive(root, url.searchParams.get("path") ?? ""),
          { headers },
        );
      if (url.pathname === "/api/photo") {
        const path = await resolveArchive(
          root,
          url.searchParams.get("path") ?? "",
        );
        const type = formats[extname(path).toLowerCase()];
        if (!type)
          return new Response("Unsupported photo", { status: 404, headers });
        const file = Bun.file(path);
        const etag = `"${file.size}-${file.lastModified}"`;
        const photoHeaders = {
          ...headers,
          "Content-Type": type,
          "Cache-Control": "no-store",
          ETag: etag,
        };
        if (request.headers.get("if-none-match") === etag)
          return new Response(null, { status: 304, headers: photoHeaders });
        return new Response(file, { headers: photoHeaders });
      }
      const asset = assets.get(url.pathname);
      if (asset) return new Response(Bun.file(asset), { headers });
    } catch {
      return new Response("Folder or photo unavailable", {
        status: 404,
        headers,
      });
    }
    return new Response("Not found", { status: 404, headers });
  },
});
console.log(`PicSync: ${server.url} · archive ${root}`);
await auth.printSignIn(publicUrl ?? `http://127.0.0.1:${server.port}`);
