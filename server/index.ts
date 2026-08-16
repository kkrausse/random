import { mkdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { loadConfig } from "../lib/config";
import { requireFfmpegEncoder } from "../lib/ffmpeg";
import type { MediaInfo, NormalizedCrop, PlaybackSource } from "../lib/types";
import { listMedia, resolveAsset } from "./media";

const config = await loadConfig();
const workRoot = join(config.derivedRoot, ".work");
const exportRoot = join(config.derivedRoot, "exports");
const workFiles = new Map<string, string>();
const ffmpegPath = await requireFfmpegEncoder(config.ffmpegPath, "libx264");
const gyroflowPath = process.env.GYROFLOW_PATH
  ?? join(homedir(), "Applications/Gyroflow CLI/Gyroflow.app/Contents/MacOS/gyroflow");

await rm(workRoot, { recursive: true, force: true });
await mkdir(workRoot, { recursive: true });

function containedPath(root: string, relativePath: string) {
  const result = resolve(root, relativePath);
  const fromRoot = relative(root, result);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) throw new Error("Invalid output path");
  return result;
}

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

async function serveFile(request: Request, path: string, fileSize: number, extraHeaders: Record<string, string> = {}) {
  const file = Bun.file(path);

  const range = request.headers.get("range");
  const headers = {
    "Accept-Ranges": "bytes",
    "Content-Type": mimeTypes[extname(path).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": String(fileSize),
    ...extraHeaders,
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

async function resolvePlaybackSource(id: string, source: string) {
  const { sourcePath, sourceStat } = await resolveAsset(config, id);
  if (source !== "proxy") return { path: sourcePath, size: sourceStat.size, originalPath: sourcePath };

  const infoFile = Bun.file(join(config.derivedRoot, id, "info.json"));
  const proxyPath = join(config.derivedRoot, id, "proxy.mp4");
  const proxyFile = Bun.file(proxyPath);
  if (!config.proxy.enabled || !(await infoFile.exists()) || !(await proxyFile.exists())) {
    throw new Error("Proxy is unavailable");
  }
  const info = await infoFile.json() as MediaInfo;
  const proxyIsFresh = info.sourceMtimeMs === sourceStat.mtimeMs
    && info.sourceSize === sourceStat.size
    && JSON.stringify(info.proxy) === JSON.stringify(config.proxy);
  if (!proxyIsFresh) throw new Error("Proxy is unavailable");
  return { path: proxyPath, size: proxyFile.size, originalPath: sourcePath };
}

async function serveVideo(request: Request, id: string, source: string) {
  try {
    const video = await resolvePlaybackSource(id, source);
    return serveFile(request, video.path, video.size);
  } catch (error) {
    if (error instanceof Error && error.message === "Proxy is unavailable") {
      return json({ error: error.message }, 404);
    }
    throw error;
  }
}

async function runGyroflow(
  input: string,
  output: string,
  source: PlaybackSource,
  outputSize: { width: number; height: number } | undefined,
  signal: AbortSignal,
) {
  if (!(await Bun.file(gyroflowPath).exists())) throw new Error(`Gyroflow CLI not found: ${gyroflowPath}`);
  const outputParams = JSON.stringify({
    codec: "H.264/AVC",
    bitrate: source === "proxy" ? 20 : 60,
    use_gpu: true,
    audio: true,
    pixel_format: "YUV420P",
    ...(outputSize ? { output_width: outputSize.width, output_height: outputSize.height } : {}),
    output_path: output,
  });
  const args = [input, "-f", "-r", "apple m", "--stdout-progress", "-p", outputParams];
  const process = Bun.spawn([gyroflowPath, ...args], { stdout: "pipe", stderr: "pipe" });
  const abort = () => process.kill();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    if (signal.aborted) throw new Error("Stabilization cancelled");
    const log = `${stderr}\n${stdout}`.trim();
    if (exitCode !== 0 || log.includes("Rendering failed:")) {
      throw new Error(`Gyroflow failed: ${log || `exit code ${exitCode}`}`);
    }
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

async function runFfmpeg(input: string, output: string, crop: NormalizedCrop | undefined, signal: AbortSignal) {
  const filters = crop ? [
    `crop=trunc(iw*${crop.width}/2)*2:trunc(ih*${crop.height}/2)*2:trunc(iw*${crop.x}/2)*2:trunc(ih*${crop.y}/2)*2`,
  ] : [];
  const args = [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-i", input,
    "-map", "0:v:0", "-map", "0:a:0?",
    "-map_metadata", "-1",
    ...(filters.length ? ["-vf", filters.join(",")] : []),
    "-c:v", "libx264", "-preset", "slow", "-crf", String(config.export.quality),
    "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    output,
  ];
  const process = Bun.spawn([ffmpegPath, ...args], { stdout: "ignore", stderr: "pipe" });
  const abort = () => process.kill();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const [stderr, exitCode] = await Promise.all([new Response(process.stderr).text(), process.exited]);
    if (signal.aborted) throw new Error("Export cancelled");
    if (exitCode !== 0) throw new Error(`FFmpeg failed: ${stderr.trim() || `exit code ${exitCode}`}`);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

function validateCrop(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") throw new Error("Invalid crop");
  const crop = value as NormalizedCrop;
  const values = [crop.x, crop.y, crop.width, crop.height];
  if (values.some((part) => !Number.isFinite(part))
    || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0
    || crop.x + crop.width > 1 || crop.y + crop.height > 1) {
    throw new Error("Invalid crop");
  }
  return crop;
}

function exportPath(id: string) {
  const extension = extname(id);
  return containedPath(exportRoot, `${id.slice(0, -extension.length)}-export.mp4`);
}

async function exportVideo(request: Request) {
  const body = await request.json() as { id?: string; stabilize?: boolean; crop?: unknown };
  const id = body.id ?? "";
  const { sourcePath } = await resolveAsset(config, id);
  const crop = validateCrop(body.crop);
  const output = exportPath(id);
  const token = crypto.randomUUID();
  const temporaryOutput = join(dirname(output), `.${basename(output)}-${token}.tmp.mp4`);
  const stabilizedInput = join(workRoot, `${token}-stabilized.mp4`);
  await mkdir(dirname(output), { recursive: true });

  try {
    if (body.stabilize) {
      await runGyroflow(sourcePath, stabilizedInput, "original", undefined, request.signal);
    }
    await runFfmpeg(body.stabilize ? stabilizedInput : sourcePath, temporaryOutput, crop, request.signal);
    await rename(temporaryOutput, output);
    return json({
      filename: basename(output),
      url: `/api/media/export?id=${encodeURIComponent(id)}`,
    });
  } finally {
    await Promise.all([rm(temporaryOutput, { force: true }), rm(stabilizedInput, { force: true })]);
  }
}

async function serveExport(request: Request, id: string) {
  await resolveAsset(config, id);
  const output = exportPath(id);
  const file = Bun.file(output);
  if (!(await file.exists())) return json({ error: "Export is unavailable" }, 404);
  return serveFile(request, output, file.size, {
    "Content-Disposition": `attachment; filename="${basename(output).replaceAll('"', "")}"`,
  });
}

async function stabilizeVideo(request: Request) {
  const body = await request.json() as { id?: string; source?: PlaybackSource };
  const source = body.source === "original" ? "original" : "proxy";
  const video = await resolvePlaybackSource(body.id ?? "", source);
  const info = await Bun.file(join(config.derivedRoot, body.id ?? "", "info.json")).json() as MediaInfo;
  const outputHeight = Math.min(info.height, config.proxy.maxHeight);
  const outputSize = source === "proxy" ? {
    width: Math.max(2, Math.floor(info.width * outputHeight / info.height / 2) * 2),
    height: Math.max(2, Math.floor(outputHeight / 2) * 2),
  } : undefined;
  const workId = crypto.randomUUID();
  const output = join(workRoot, `${workId}.mp4`);
  try {
    // Sony's lens, IBIS, and per-frame gyro metadata only survives in the original container.
    await runGyroflow(video.originalPath, output, source, outputSize, request.signal);
    if (!(await Bun.file(output).exists())) throw new Error("Gyroflow did not create an output file");
    workFiles.set(workId, output);
    return json({ workId, url: `/api/media/work?id=${workId}` });
  } catch (error) {
    await Promise.all([rm(output, { force: true }), rm(`${output}.tmp`, { force: true })]);
    throw error;
  }
}

async function serveWork(request: Request, id: string) {
  const path = workFiles.get(id);
  if (!path) return json({ error: "Preview is unavailable" }, 404);
  const file = Bun.file(path);
  if (!(await file.exists())) return json({ error: "Preview is unavailable" }, 404);
  return serveFile(request, path, file.size);
}

async function deleteWork(id: string) {
  const path = workFiles.get(id);
  if (path) await rm(path, { force: true });
  workFiles.delete(id);
  return new Response(null, { status: 204 });
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
  if (request.method === "POST" && url.pathname === "/api/media/stabilize") {
    return stabilizeVideo(request);
  }
  if (request.method === "POST" && url.pathname === "/api/media/export") {
    return exportVideo(request);
  }
  if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/api/media/export") {
    return serveExport(request, url.searchParams.get("id") ?? "");
  }
  if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/api/media/work") {
    return serveWork(request, url.searchParams.get("id") ?? "");
  }
  if (request.method === "DELETE" && url.pathname === "/api/media/work") {
    return deleteWork(url.searchParams.get("id") ?? "");
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
