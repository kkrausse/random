import { extname, join, resolve } from "node:path";
import { loadConfig } from "../lib/config";
import type { MediaInfo } from "../lib/types";
import { listMedia, resolveAsset } from "./media";

const config = await loadConfig();

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".m4v": "video/x-m4v",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
};

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

async function serveFile(request: Request, path: string, fileSize: number) {
  const file = Bun.file(path);

  const range = request.headers.get("range");
  const headers = {
    "Accept-Ranges": "bytes",
    "Content-Type": mimeTypes[extname(path).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": String(fileSize),
  };
  if (!range) {
    return new Response(request.method === "HEAD" ? null : file, { headers });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${fileSize}` } });
  const suffixLength = !match[1] && match[2] ? Number(match[2]) : undefined;
  const start = suffixLength === undefined ? Number(match[1]) : Math.max(fileSize - suffixLength, 0);
  const end = suffixLength === undefined && match[2] ? Math.min(Number(match[2]), fileSize - 1) : fileSize - 1;
  if (start > end || start >= fileSize) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${fileSize}` } });
  }
  return new Response(request.method === "HEAD" ? null : file.slice(start, end + 1), {
    status: 206,
    headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${fileSize}`, "Content-Length": String(end - start + 1) },
  });
}

async function serveVideo(request: Request, id: string, source: string) {
  const { sourcePath, sourceStat } = await resolveAsset(config, id);
  if (source !== "proxy") return serveFile(request, sourcePath, sourceStat.size);

  const infoFile = Bun.file(join(config.derivedRoot, id, "info.json"));
  const proxyPath = join(config.derivedRoot, id, "proxy.mp4");
  const proxyFile = Bun.file(proxyPath);
  if (!config.proxy.enabled || !(await infoFile.exists()) || !(await proxyFile.exists())) {
    return json({ error: "Proxy is unavailable" }, 404);
  }
  const info = await infoFile.json() as MediaInfo;
  const proxyIsFresh = info.sourceMtimeMs === sourceStat.mtimeMs
    && info.sourceSize === sourceStat.size
    && JSON.stringify(info.proxy) === JSON.stringify(config.proxy);
  if (!proxyIsFresh) return json({ error: "Proxy is unavailable" }, 404);
  return serveFile(request, proxyPath, proxyFile.size);
}

async function serveThumbnail(id: string) {
  await resolveAsset(config, id);
  const file = Bun.file(join(config.derivedRoot, id, "thumbnail.jpg"));
  if (!(await file.exists())) return json({ error: "Thumbnail has not been scanned" }, 404);
  return new Response(file, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" },
  });
}

async function serveMediaInfo(id: string) {
  await resolveAsset(config, id);
  const file = Bun.file(join(config.derivedRoot, id, "info.json"));
  if (!(await file.exists())) return json({ error: "Media has not been scanned" }, 404);
  return new Response(file, { headers: { "Content-Type": "application/json; charset=utf-8" } });
}

async function handleApi(request: Request, url: URL) {
  if (request.method === "GET" && url.pathname === "/api/media") {
    return json({ media: await listMedia(config) });
  }
  if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/api/media/video") {
    return serveVideo(request, url.searchParams.get("id") ?? "", url.searchParams.get("source") ?? "original");
  }
  if (request.method === "GET" && url.pathname === "/api/media/thumbnail") {
    return serveThumbnail(url.searchParams.get("id") ?? "");
  }
  if (request.method === "GET" && url.pathname === "/api/media/info") {
    return serveMediaInfo(url.searchParams.get("id") ?? "");
  }
  return json({ error: "Not found" }, 404);
}

const distRoot = resolve("dist");
const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(request, url);

      const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const staticFile = Bun.file(join(distRoot, requested));
      if (await staticFile.exists()) {
        return new Response(staticFile, { headers: { "Content-Type": mimeTypes[extname(requested)] ?? "application/octet-stream" } });
      }
      const index = Bun.file(join(distRoot, "index.html"));
      if (await index.exists()) return new Response(index, { headers: { "Content-Type": mimeTypes[".html"] } });
      return new Response("Frontend is not built. Run `bun run dev` or `bun run build`.", { status: 404 });
    } catch (error) {
      console.error(error);
      return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
    }
  },
});

console.log(`Video editor server: ${server.url}`);
console.log(`Read-only media library: ${config.mediaRoot}`);
