import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { loadConfig } from "../lib/config";
import { requireFfmpegEncoder } from "../lib/ffmpeg";
import type { MediaInfo, NormalizedCrop, PlaybackSource } from "../lib/types";
import { runGyroflow } from "./gyroflow";
import { listMedia, MediaNotFoundError, paginateMedia, resolveAsset } from "./media";
import { exportProject, projectExportPath, ProjectExportValidationError } from "./project-export";
import {
  createProject,
  deleteProject,
  listProjects,
  ProjectConflictError,
  ProjectNotFoundError,
  ProjectValidationError,
  readProject,
  updateProject,
} from "./projects";

const config = await loadConfig();
const workRoot = join(config.derivedRoot, ".work");
const exportRoot = join(config.derivedRoot, "exports");
const workFiles = new Map<string, string>();
const ffmpegPath = await requireFfmpegEncoder(config.ffmpegPath, "libx264");
const ffprobePath = process.env.FFPROBE_PATH ?? join(dirname(ffmpegPath), "ffprobe");
const gyroflowPath = process.env.GYROFLOW_PATH
  ?? join(homedir(), "Applications/Gyroflow CLI/Gyroflow.app/Contents/MacOS/gyroflow");

const removeWork = (path: string) => rm(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });

await mkdir(workRoot, { recursive: true });
const staleWork = await readdir(workRoot);
const staleCleanup = await Promise.allSettled(staleWork.map((name) => removeWork(join(workRoot, name))));
for (const result of staleCleanup) {
  if (result.status === "rejected") console.warn(`Could not remove stale work output: ${result.reason}`);
}

class MediaKindError extends Error {}

function containedPath(root: string, relativePath: string) {
  const result = resolve(root, relativePath);
  const fromRoot = relative(root, result);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) throw new Error("Invalid output path");
  return result;
}

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".avi": "video/x-msvideo",
  ".html": "text/html; charset=utf-8",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".m4v": "video/x-m4v",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".webm": "video/webm",
  ".webp": "image/webp",
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
  const { sourcePath, sourceStat, kind } = await resolveAsset(config, id);
  if (kind !== "video") throw new MediaKindError("Media asset is not a video");
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
  const { sourcePath, kind } = await resolveAsset(config, id);
  if (kind !== "video") throw new MediaKindError("Media asset is not a video");
  const crop = validateCrop(body.crop);
  const output = exportPath(id);
  const token = crypto.randomUUID();
  const temporaryOutput = join(dirname(output), `.${basename(output)}-${token}.tmp.mp4`);
  const stabilizedInput = join(workRoot, `${token}-stabilized.mp4`);
  await mkdir(dirname(output), { recursive: true });

  try {
    if (body.stabilize) {
      await runGyroflow(gyroflowPath, sourcePath, stabilizedInput, "original", undefined, request.signal);
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
  const { kind } = await resolveAsset(config, id);
  if (kind !== "video") throw new MediaKindError("Media asset is not a video");
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
    await runGyroflow(gyroflowPath, video.originalPath, output, source, outputSize, request.signal);
    if (!(await Bun.file(output).exists())) throw new Error("Gyroflow did not create an output file");
    workFiles.set(workId, output);
    return json({ workId, url: `/api/media/work?id=${workId}` });
  } catch (error) {
    await Promise.allSettled([removeWork(output), removeWork(`${output}.tmp`)]);
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
  if (path) await removeWork(path);
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

async function servePhoto(request: Request, id: string) {
  const asset = await resolveAsset(config, id);
  if (asset.kind !== "photo") throw new MediaKindError("Media asset is not a photo");
  return serveFile(request, asset.sourcePath, asset.sourceStat.size, { "Cache-Control": "private, max-age=3600" });
}

async function serveMediaInfo(id: string) {
  await resolveAsset(config, id);
  const file = Bun.file(join(config.derivedRoot, id, "info.json"));
  if (!(await file.exists())) return json({ error: "Media has not been scanned" }, 404);
  return new Response(file, { headers: { "Content-Type": "application/json; charset=utf-8" } });
}

async function exportSavedProject(request: Request, id: string) {
  const text = await request.text();
  const body = (text ? JSON.parse(text) : {}) as { revision?: unknown };
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).some((key) => key !== "revision")) {
    throw new ProjectExportValidationError("Invalid project export request");
  }
  if (body.revision !== undefined
    && (typeof body.revision !== "number" || !Number.isInteger(body.revision) || body.revision < 1)) {
    throw new ProjectExportValidationError("Invalid project revision");
  }
  const result = await exportProject(config, { ffmpegPath, ffprobePath, gyroflowPath }, id, body.revision, request.signal);
  return json({
    filename: result.filename,
    url: `/api/projects/${encodeURIComponent(id)}/export`,
    revision: result.revision,
    audio: result.audio,
  });
}

async function serveProjectExport(request: Request, id: string) {
  const project = await readProject(config.savedProjectsRoot, id);
  const path = projectExportPath(config, id);
  const file = Bun.file(path);
  if (!(await file.exists())) return json({ error: "Project export is unavailable" }, 404);
  const filename = `${project.name.replaceAll(/[\\/\"\r\n]/g, "_")}.mp4`;
  const asciiFilename = filename.replaceAll(/[^\x20-\x7e]/g, "_");
  return serveFile(request, path, file.size, {
    "Content-Disposition": `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "X-Video-Editor-Audio": "none",
  });
}

async function handleApi(request: Request, url: URL) {
  if (request.method === "GET" && url.pathname === "/api/projects") {
    return json({ projects: await listProjects(config.savedProjectsRoot) });
  }
  if (request.method === "POST" && url.pathname === "/api/projects") {
    return json(await createProject(config.savedProjectsRoot, await request.json()), 201);
  }
  const projectExportMatch = /^\/api\/projects\/([^/]+)\/export$/.exec(url.pathname);
  if (projectExportMatch) {
    const id = decodeURIComponent(projectExportMatch[1] ?? "");
    if (request.method === "POST") return exportSavedProject(request, id);
    if (request.method === "GET" || request.method === "HEAD") return serveProjectExport(request, id);
  }
  const projectMatch = /^\/api\/projects\/([^/]+)$/.exec(url.pathname);
  if (projectMatch) {
    const id = decodeURIComponent(projectMatch[1] ?? "");
    if (request.method === "GET") return json(await readProject(config.savedProjectsRoot, id));
    if (request.method === "PUT") return json(await updateProject(config.savedProjectsRoot, id, await request.json()));
    if (request.method === "DELETE") {
      await deleteProject(config.savedProjectsRoot, id, Number(url.searchParams.get("revision")));
      await rm(projectExportPath(config, id), { force: true, maxRetries: 8, retryDelay: 250 });
      return new Response(null, { status: 204 });
    }
  }
  if (request.method === "GET" && url.pathname === "/api/media") {
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit === null ? 48 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new SyntaxError("Media page limit must be between 1 and 100");
    return json(paginateMedia(await listMedia(config), limit, url.searchParams.get("cursor"), url.searchParams.get("includePhotos") === "true"));
  }
  if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/api/media/video") {
    return serveVideo(request, url.searchParams.get("id") ?? "", url.searchParams.get("source") ?? "original");
  }
  if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/api/media/photo") {
    return servePhoto(request, url.searchParams.get("id") ?? "");
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
      if (request.signal.aborted) return new Response(null, { status: 499 });
      if (error instanceof ProjectValidationError || error instanceof ProjectExportValidationError
        || error instanceof SyntaxError || error instanceof URIError) {
        return json({ error: error.message }, 400);
      }
      if (error instanceof ProjectNotFoundError) return json({ error: error.message }, 404);
      if (error instanceof ProjectConflictError) return json({ error: error.message }, 409);
      if (error instanceof MediaNotFoundError) return json({ error: error.message }, 404);
      if (error instanceof MediaKindError) return json({ error: error.message }, 400);
      console.error(error);
      return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
    }
  },
});

console.log(`Video editor server: ${server.url}`);
console.log(`Read-only media library: ${config.mediaRoot}`);
