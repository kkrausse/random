import { realpath } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { BlockList } from "node:net";
import { formats, listArchive, resolveArchive } from "./archive";
import { PicSyncAuth } from "./auth";
import { loadCredentials } from "./credentials";
import { createClientErrorHandler } from "./client-errors";
import { createPreviews } from "./previews";
import { createConversions } from "./conversions";

const port = Number(process.env.PORT ?? 8789);
const publicUrl = process.env.PICSYNC_PUBLIC_URL;
const lanUrl = process.env.PICSYNC_LAN_URL;
const auth = new PicSyncAuth(port, publicUrl, await loadCredentials(port),
  lanUrl ? { origin: lanUrl, cidr: process.env.LAN_CIDR ?? "127.0.0.0/8" } : undefined);
const clientError = createClientErrorHandler();
const preview = createPreviews();
const render = createConversions();

const root = await realpath(process.env.MEDIA_ROOT ?? "/home/pi/photos");
const modern = dirname(Bun.resolveSync("libraw-modern", import.meta.dir));
const assets = new Map<string, string>([
  ["/", join(import.meta.dir, "index.html")],
  ["/app.js", join(import.meta.dir, "dist/app.js")],
  ["/app.css", join(import.meta.dir, "dist/app.css")],
  ["/strip-worker.js", join(import.meta.dir, "strip-worker.js")],
  ["/error-details.js", join(import.meta.dir, "error-details.js")],
  ...[
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
allowed.addSubnet("127.0.0.0", 8, "ipv4");
const baseHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
};
const server = Bun.serve({
  idleTimeout: 255,
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
    const isolated = !lanUrl || ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname);
    const headers: Record<string, string> = { ...baseHeaders, ...(isolated ? {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    } : {}) };
    const peer = server.requestIP(request)?.address.replace(/^::ffff:/, "");
    if (!peer || !allowed.check(peer, "ipv4"))
      return new Response("LAN only", { status: 403, headers });
    const denied = await auth.guard(request, peer);
    if (denied) {
      if (denied.status >= 400 || denied.status === 303)
        console.warn("[PicSync] Request denied", { method: request.method,
          route: new URL(request.url).pathname, status: denied.status,
          session: auth.sessionStatus(request),
          fetchSite: request.headers.get("sec-fetch-site")?.slice(0, 32),
          browser: request.headers.get("user-agent")?.slice(0, 256) });
      return denied;
    }
    if (new URL(request.url).pathname === "/api/client-error" && request.method === "POST")
      return clientError(request);
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
      if (url.pathname === "/api/render") {
        const path = await resolveArchive(root, url.searchParams.get("path") ?? "");
        if (!formats[extname(path).toLowerCase()]) return new Response("Unsupported photo", { status: 404, headers });
        const size = url.searchParams.get("size");
        if (size !== "full" && size !== "thumb") return new Response("Invalid render size", { status: 400, headers });
        const value = Number(url.searchParams.get("priority") ?? 0);
        const priority = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 100;
        try {
          const image = await render(path, size === "full", priority, request.signal);
          return new Response(request.method === "HEAD" ? null : new Uint8Array(image.bytes), { headers: {
            ...headers, "Content-Type": "image/jpeg", "Content-Length": String(image.bytes.byteLength),
            "X-PicSync-Source": image.source, "X-PicSync-Width": String(image.width), "X-PicSync-Height": String(image.height),
          } });
        } catch (error) {
          if (!request.signal.aborted) console.error("[PicSync] Server conversion failed", { path, size, error });
          return new Response("Server image conversion failed", { status: 503, headers });
        }
      }
      if (url.pathname === "/api/preview") {
        const path = await resolveArchive(root, url.searchParams.get("path") ?? "");
        if (!/\.(arw|dng)$/i.test(path)) return new Response(null, { status: 204, headers });
        try {
          const image = await preview(path);
          if (!image) return new Response(null, { status: 204, headers });
          return new Response(request.method === "HEAD" ? null : new Uint8Array(image.bytes), { headers: {
            ...headers, "Content-Type": "image/jpeg",
            "Content-Length": String(image.bytes.byteLength),
            "X-PicSync-Orientation": String(image.orientation),
          } });
        } catch (error) {
          console.error("[PicSync] Preview extraction failed", { path, error });
          return new Response("Preview extraction failed", { status: 503, headers });
        }
      }
      const asset = assets.get(url.pathname);
      if (asset) {
        const file = Bun.file(asset);
        // Authentication above must run even for cache revalidation. HTML and
        // private archive data remain no-store; only application code is cached.
        if (url.pathname === "/") return new Response(file, { headers });
        const etag = `"${file.size}-${file.lastModified}"`;
        const assetHeaders = {
          ...headers,
          "Cache-Control": "private, no-cache, must-revalidate",
          ETag: etag,
          Vary: "Cookie",
        };
        if (request.headers.get("if-none-match") === etag)
          return new Response(null, { status: 304, headers: assetHeaders });
        return new Response(file, { headers: assetHeaders });
      }
    } catch (error) {
      console.error("[PicSync] Archive request failed", { route: url.pathname, error });
      return new Response("Folder or photo unavailable", {
        status: 404,
        headers,
      });
    }
    return new Response("Not found", { status: 404, headers });
  },
});
console.log(`PicSync: ${server.url} · archive ${root}`);
await auth.printSignIn(lanUrl ?? publicUrl ?? `http://127.0.0.1:${server.port}`);
