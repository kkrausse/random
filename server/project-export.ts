import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { AppConfig, NormalizedCrop, ProjectSettings, TimelineItem } from "../lib/types";
import { resolveAsset } from "./media";
import { ProjectConflictError, readProject } from "./projects";
import { runGyroflow } from "./gyroflow";

export class ProjectExportValidationError extends Error {}

type ExportTools = {
  ffmpegPath: string;
  ffprobePath: string;
  gyroflowPath: string;
};

type ProbeResult = {
  streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>;
  format?: { duration?: string };
};

const MAX_DIMENSION = 8192;
const MAX_FPS = 240;

function fail(message: string): never {
  throw new ProjectExportValidationError(message);
}

export function validateExportSettings(settings: ProjectSettings) {
  if (settings.width < 2 || settings.height < 2
    || settings.width > MAX_DIMENSION || settings.height > MAX_DIMENSION
    || settings.width % 2 !== 0 || settings.height % 2 !== 0) {
    fail(`Export dimensions must be even and between 2 and ${MAX_DIMENSION}`);
  }
  if (settings.fps <= 0 || settings.fps > MAX_FPS) fail(`Export fps must be at most ${MAX_FPS}`);
  return settings;
}

function cropFilter(crop: NormalizedCrop) {
  const width = `max(1\,floor(iw*${crop.width}))`;
  const height = `max(1\,floor(ih*${crop.height}))`;
  const x = `min(iw-ow\,max(0\,floor(iw*${crop.x})))`;
  const y = `min(ih-oh\,max(0\,floor(ih*${crop.y})))`;
  return `crop=w='${width}':h='${height}':x='${x}':y='${y}'`;
}

export function buildSegmentFilters(settings: ProjectSettings, crop?: NormalizedCrop) {
  const filters = crop
    ? [cropFilter(crop), `scale=${settings.width}:${settings.height}`]
    : [
        `scale=${settings.width}:${settings.height}:force_original_aspect_ratio=increase`,
        `crop=${settings.width}:${settings.height}`,
      ];
  return [...filters, "setsar=1", `fps=${settings.fps}`, "format=yuv420p"].join(",");
}

export function validateVideoTrim(sourceIn: number, sourceOut: number, duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) fail("Source video has no valid duration");
  if (sourceIn < 0 || sourceOut <= sourceIn || sourceOut > duration + 0.01) {
    fail(`Video trim ${sourceIn}-${sourceOut} is outside source duration ${duration}`);
  }
}

export function validateCropAspect(
  crop: NormalizedCrop | undefined,
  sourceWidth: number,
  sourceHeight: number,
  settings: ProjectSettings,
  label?: string,
) {
  if (!crop) return;
  const cropAspect = crop.width * sourceWidth / (crop.height * sourceHeight);
  const projectAspect = settings.width / settings.height;
  if (Math.abs(cropAspect / projectAspect - 1) > 0.01) {
    fail(`${label ? `${label}: ` : ""}Crop aspect ratio does not match the project frame`);
  }
}

async function runProcess(command: string[], signal: AbortSignal, label: string) {
  if (signal.aborted) throw new Error(`${label} cancelled`);
  const process = Bun.spawn(command, { stdout: "ignore", stderr: "pipe" });
  const abort = () => process.kill();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const [stderr, exitCode] = await Promise.all([new Response(process.stderr).text(), process.exited]);
    if (signal.aborted) throw new Error(`${label} cancelled`);
    if (exitCode !== 0) throw new Error(`${label} failed: ${stderr.trim() || `exit code ${exitCode}`}`);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

async function probeVideo(path: string, tools: ExportTools, signal: AbortSignal) {
  if (signal.aborted) throw new Error("Export cancelled");
  const process = Bun.spawn([
    tools.ffprobePath, "-v", "error", "-show_entries",
    "stream=codec_type,width,height,duration:format=duration", "-of", "json", path,
  ], { stdout: "pipe", stderr: "pipe" });
  const abort = () => process.kill();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited,
    ]);
    if (signal.aborted) throw new Error("Export cancelled");
    if (exitCode !== 0) throw new Error(`FFprobe failed: ${stderr.trim() || `exit code ${exitCode}`}`);
    const result = JSON.parse(stdout) as ProbeResult;
    const stream = result.streams?.find((candidate) => candidate.codec_type === "video");
    const duration = Number(stream?.duration ?? result.format?.duration);
    if (!stream || !stream.width || !stream.height) fail("Source has no valid video stream");
    return { width: stream.width, height: stream.height, duration };
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

function encoderArgs(config: AppConfig) {
  return [
    "-map", "0:v:0", "-an", "-map_metadata", "-1",
    "-c:v", "libx264", "-preset", "slow", "-crf", String(config.export.quality),
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
  ];
}

async function renderSegment(
  config: AppConfig,
  tools: ExportTools,
  item: TimelineItem,
  settings: ProjectSettings,
  index: number,
  jobDir: string,
  stabilizedSources: Map<string, string>,
  signal: AbortSignal,
) {
  const asset = await resolveAsset(config, item.mediaId);
  if (asset.kind !== item.kind) fail(`Timeline item ${item.id} is ${item.kind}, but media is ${asset.kind}`);
  const output = join(jobDir, `segment-${String(index).padStart(5, "0")}.mp4`);
  const filters = buildSegmentFilters(settings, item.crop);

  if (item.kind === "photo") {
    let input = asset.sourcePath;
    if (extname(input).toLowerCase() === ".arw") {
      input = join(jobDir, `photo-${String(index).padStart(5, "0")}.jpg`);
      await runProcess([
        "/usr/bin/sips", "-s", "format", "jpeg", "-s", "formatOptions", "95",
        asset.sourcePath, "--out", input,
      ], signal, "RAW photo conversion");
    }
    const metadata = await probeVideo(input, tools, signal);
    validateCropAspect(item.crop, metadata.width, metadata.height, settings, `Item ${index + 1} (${item.mediaId})`);
    await runProcess([
      tools.ffmpegPath, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-loop", "1", "-framerate", String(settings.fps), "-t", String(item.photoDuration),
      "-i", input, "-vf", filters, ...encoderArgs(config), output,
    ], signal, "FFmpeg photo render");
    return output;
  }

  const metadata = await probeVideo(asset.sourcePath, tools, signal);
  validateVideoTrim(item.sourceIn, item.sourceOut, metadata.duration);
  validateCropAspect(item.crop, metadata.width, metadata.height, settings, `Item ${index + 1} (${item.mediaId})`);
  let input = asset.sourcePath;
  if (item.stabilize) {
    const cached = stabilizedSources.get(asset.sourcePath);
    if (cached) {
      input = cached;
    } else {
      input = join(jobDir, `stabilized-${stabilizedSources.size}.mp4`);
      // Gyroflow needs the complete Original Sony container before any trim removes gyro metadata.
      await runGyroflow(tools.gyroflowPath, asset.sourcePath, input, "original", undefined, signal);
      stabilizedSources.set(asset.sourcePath, input);
    }
  }
  await runProcess([
    tools.ffmpegPath, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-ss", String(item.sourceIn), "-t", String(item.sourceOut - item.sourceIn), "-i", input,
    "-vf", filters, ...encoderArgs(config), output,
  ], signal, "FFmpeg video render");
  return output;
}

export async function exportProject(
  config: AppConfig,
  tools: ExportTools,
  projectId: string,
  expectedRevision: number | undefined,
  signal: AbortSignal,
) {
  const project = await readProject(config.savedProjectsRoot, projectId);
  if (expectedRevision !== undefined && expectedRevision !== project.revision) {
    throw new ProjectConflictError("Project revision conflict");
  }
  if (project.items.length === 0) fail("Cannot export an empty timeline");
  const settings = validateExportSettings(project.settings);

  const jobDir = join(config.derivedRoot, ".work", crypto.randomUUID());
  const final = join(config.derivedRoot, "exports", "projects", `${project.id}.mp4`);
  const temporaryFinal = join(jobDir, "final.mp4");
  await mkdir(jobDir, { recursive: true });
  try {
    const stabilizedSources = new Map<string, string>();
    const segments: string[] = [];
    for (const [index, item] of project.items.entries()) {
      segments.push(await renderSegment(config, tools, item, settings, index, jobDir, stabilizedSources, signal));
    }
    const concatFile = join(jobDir, "segments.txt");
    await writeFile(concatFile, segments.map((path) => `file '${path.replaceAll("'", "'\\''")}'`).join("\n") + "\n");
    await runProcess([
      tools.ffmpegPath, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-f", "concat", "-safe", "0", "-i", concatFile, "-map", "0:v:0", "-an",
      "-c", "copy", "-movflags", "+faststart", temporaryFinal,
    ], signal, "FFmpeg project concat");
    if (signal.aborted) throw new Error("Export cancelled");
    const current = await readProject(config.savedProjectsRoot, projectId);
    if (current.revision !== project.revision) throw new ProjectConflictError("Project changed during export");
    await mkdir(dirname(final), { recursive: true });
    await rename(temporaryFinal, final);
    return {
      path: final,
      filename: `${project.name.replaceAll(/[\\/\"\r\n]/g, "_") || basename(final)}.mp4`,
      revision: project.revision,
      audio: "none" as const,
    };
  } finally {
    await rm(jobDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
}

export function projectExportPath(config: AppConfig, projectId: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(projectId)) fail("Invalid project id");
  return join(config.derivedRoot, "exports", "projects", `${projectId}.mp4`);
}
