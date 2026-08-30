import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { concurrentMap } from "../lib/concurrency";
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

export type ExportProgress = (message: string, percent: number) => void;

type ProbeResult = {
  streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>;
  format?: { duration?: string };
};

type VideoMetadata = Awaited<ReturnType<typeof probeVideo>>;

type ExportStats = {
  probes: number;
  probeMs: number;
  rawConversionMs: number;
  stabilizationMs: number;
  renderMs: number;
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
  return [...filters, "setsar=1", "setpts=PTS-STARTPTS", `fps=${settings.fps}`, "format=yuv420p"].join(",");
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
    return {
      width: stream.width,
      height: stream.height,
      duration,
      hasAudio: result.streams?.some((candidate) => candidate.codec_type === "audio") ?? false,
    };
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

function encoderArgs(config: AppConfig, audioInput: number, audioSamples: number) {
  return [
    "-map", "0:v:0", "-map", `${audioInput}:a:0`, "-map_metadata", "-1",
    "-c:v", "libx264", "-preset", "slow", "-crf", String(config.export.quality),
    "-pix_fmt", "yuv420p",
    "-af", `aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo,apad,atrim=end_sample=${audioSamples},asetpts=PTS-STARTPTS`,
    "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2",
  ];
}

export function segmentFrameCount(duration: number, fps: number) {
  return Math.ceil(duration * fps - 1e-9);
}

export function segmentDuration(duration: number, fps: number) {
  return segmentFrameCount(duration, fps) / fps;
}

function timedSegmentFilters(settings: ProjectSettings, crop: NormalizedCrop | undefined, frames: number) {
  return `${buildSegmentFilters(settings, crop)},tpad=stop_mode=clone:stop_duration=${1 / settings.fps},`
    + `trim=end_frame=${frames},setpts=PTS-STARTPTS`;
}

async function renderSegment(
  config: AppConfig,
  tools: ExportTools,
  item: TimelineItem,
  settings: ProjectSettings,
  index: number,
  jobDir: string,
  stabilizedSources: Map<string, Promise<string>>,
  probes: Map<string, Promise<VideoMetadata>>,
  stats: ExportStats,
  signal: AbortSignal,
  reportProgress: ExportProgress,
  progress: number,
) {
  const asset = await resolveAsset(config, item.mediaId);
  if (asset.kind !== item.kind) fail(`Timeline item ${item.id} is ${item.kind}, but media is ${asset.kind}`);
  const output = join(jobDir, `segment-${String(index).padStart(5, "0")}.mov`);

  if (item.kind === "photo") {
    let input = asset.sourcePath;
    if (extname(input).toLowerCase() === ".arw") {
      reportProgress(`Converting item ${index + 1} (${item.mediaId})`, progress);
      input = join(jobDir, `photo-${String(index).padStart(5, "0")}.jpg`);
      const conversionStarted = performance.now();
      await runProcess([
        "/usr/bin/sips", "-s", "format", "jpeg", "-s", "formatOptions", "95",
        asset.sourcePath, "--out", input,
      ], signal, "RAW photo conversion");
      stats.rawConversionMs += performance.now() - conversionStarted;
    }
    const probeStarted = performance.now();
    const metadata = await probeVideo(input, tools, signal);
    stats.probes++;
    stats.probeMs += performance.now() - probeStarted;
    validateCropAspect(item.crop, metadata.width, metadata.height, settings, `Item ${index + 1} (${item.mediaId})`);
    const frames = segmentFrameCount(item.photoDuration, settings.fps);
    const duration = frames / settings.fps;
    const filters = timedSegmentFilters(settings, item.crop, frames);
    reportProgress(`Rendering item ${index + 1} (${item.mediaId})`, progress);
    const renderStarted = performance.now();
    await runProcess([
      tools.ffmpegPath, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-loop", "1", "-framerate", String(settings.fps), "-t", String(duration),
      "-i", input, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
      "-vf", filters, ...encoderArgs(config, 1, Math.round(duration * 48000)), output,
    ], signal, "FFmpeg photo render");
    stats.renderMs += performance.now() - renderStarted;
    return output;
  }

  let probe = probes.get(asset.sourcePath);
  if (!probe) {
    const probeStarted = performance.now();
    probe = probeVideo(asset.sourcePath, tools, signal).finally(() => {
      stats.probes++;
      stats.probeMs += performance.now() - probeStarted;
    });
    probes.set(asset.sourcePath, probe);
  }
  const metadata = await probe;
  validateVideoTrim(item.sourceIn, item.sourceOut, metadata.duration);
  validateCropAspect(item.crop, metadata.width, metadata.height, settings, `Item ${index + 1} (${item.mediaId})`);
  let input = asset.sourcePath;
  let inputStart = item.sourceIn;
  if (item.stabilize) {
    const stabilizationKey = `${asset.sourcePath}:${item.sourceIn}:${item.sourceOut}`;
    const cached = stabilizedSources.get(stabilizationKey);
    if (cached) {
      input = await cached;
    } else {
      reportProgress(`Stabilizing item ${index + 1} (${item.mediaId})`, progress);
      const stabilized = join(jobDir, `stabilized-${String(index).padStart(5, "0")}.mp4`);
      // Gyroflow needs the complete Original Sony container before any trim removes gyro metadata.
      const stabilizationStarted = performance.now();
      const stabilization = runGyroflow(tools.gyroflowPath, asset.sourcePath, stabilized, "original", undefined, signal, {
        sourceIn: item.sourceIn,
        sourceOut: item.sourceOut,
        includeAudio: false,
      })
        .then(() => stabilized)
        .finally(() => { stats.stabilizationMs += performance.now() - stabilizationStarted; });
      stabilizedSources.set(stabilizationKey, stabilization);
      input = await stabilization;
    }
    inputStart = 0;
  }
  reportProgress(`Rendering item ${index + 1} (${item.mediaId})`, progress);
  const frames = segmentFrameCount(item.sourceOut - item.sourceIn, settings.fps);
  const duration = frames / settings.fps;
  const filters = timedSegmentFilters(settings, item.crop, frames);
  const inputs = item.stabilize
    ? ["-i", input, ...metadata.hasAudio
        ? ["-ss", String(item.sourceIn), "-t", String(duration), "-i", asset.sourcePath]
        : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]]
    : ["-ss", String(inputStart), "-t", String(duration), "-i", input,
        ...metadata.hasAudio ? [] : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]];
  const audioInput = item.stabilize || !metadata.hasAudio ? 1 : 0;
  const renderStarted = performance.now();
  await runProcess([
    tools.ffmpegPath, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    ...inputs, "-vf", filters, ...encoderArgs(config, audioInput, Math.round(duration * 48000)), output,
  ], signal, "FFmpeg video render");
  stats.renderMs += performance.now() - renderStarted;
  return output;
}

export async function exportProject(
  config: AppConfig,
  tools: ExportTools,
  projectId: string,
  expectedRevision: number | undefined,
  signal: AbortSignal,
  reportProgress: ExportProgress = () => {},
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
  const exportStarted = performance.now();
  const stats: ExportStats = { probes: 0, probeMs: 0, rawConversionMs: 0, stabilizationMs: 0, renderMs: 0 };
  try {
    const stabilizedSources = new Map<string, Promise<string>>();
    const probes = new Map<string, Promise<VideoMetadata>>();
    const concurrency = config.export.concurrency ?? 2;
    let rendered = 0;
    const segments = await concurrentMap(project.items, concurrency, async (item, index) => {
      const progress = Math.round(rendered / project.items.length * 90);
      reportProgress(`Rendering item ${index + 1} of ${project.items.length} (${item.mediaId})`, progress);
      const segment = await renderSegment(config, tools, item, settings, index, jobDir, stabilizedSources, probes,
        stats, signal, reportProgress, progress);
      rendered++;
      reportProgress(`Rendered ${rendered} of ${project.items.length} items`, Math.round(rendered / project.items.length * 90));
      return segment;
    });
    reportProgress("Joining rendered clips", 95);
    const concatFile = join(jobDir, "segments.txt");
    await writeFile(concatFile, segments.map((path) => `file '${path.replaceAll("'", "'\\''")}'`).join("\n") + "\n");
    const concatStarted = performance.now();
    await runProcess([
      tools.ffmpegPath, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-f", "concat", "-safe", "0", "-i", concatFile, "-map", "0:v:0", "-map", "0:a:0",
      "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
      "-movflags", "+faststart", temporaryFinal,
    ], signal, "FFmpeg project concat");
    const concatMs = performance.now() - concatStarted;
    if (signal.aborted) throw new Error("Export cancelled");
    const current = await readProject(config.savedProjectsRoot, projectId);
    if (current.revision !== project.revision) throw new ProjectConflictError("Project changed during export");
    await mkdir(dirname(final), { recursive: true });
    await rename(temporaryFinal, final);
    console.info("Project export stats", {
      projectId: project.id,
      revision: project.revision,
      items: project.items.length,
      concurrency,
      totalMs: Math.round(performance.now() - exportStarted),
      probeCount: stats.probes,
      probeMs: Math.round(stats.probeMs),
      rawConversionMs: Math.round(stats.rawConversionMs),
      stabilizationMs: Math.round(stats.stabilizationMs),
      renderMs: Math.round(stats.renderMs),
      concatMs: Math.round(concatMs),
    });
    reportProgress("Export complete", 100);
    return {
      path: final,
      filename: `${project.name.replaceAll(/[\\/\"\r\n]/g, "_") || basename(final)}.mp4`,
      revision: project.revision,
      audio: "aac" as const,
    };
  } finally {
    await rm(jobDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
}

export function projectExportPath(config: AppConfig, projectId: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(projectId)) fail("Invalid project id");
  return join(config.derivedRoot, "exports", "projects", `${projectId}.mp4`);
}
