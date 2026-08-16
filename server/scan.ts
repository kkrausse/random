import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { concurrentMap } from "../lib/concurrency";
import { loadConfig } from "../lib/config";
import { requireFfmpegEncoder } from "../lib/ffmpeg";
import type { AppConfig, MediaAsset, MediaInfo } from "../lib/types";
import { runGyroflow } from "./gyroflow";
import { listMedia, resolveAsset } from "./media";

const config = await loadConfig();
const ffmpegPath = await requireFfmpegEncoder(config.ffmpegPath, "libx264");
const ffprobePath = process.env.FFPROBE_PATH ?? join(dirname(ffmpegPath), "ffprobe");
const gyroflowPath = process.env.GYROFLOW_PATH
  ?? join(homedir(), "Applications/Gyroflow CLI/Gyroflow.app/Contents/MacOS/gyroflow");
const sipsPath = "/usr/bin/sips";
const SCAN_VERSION = 6;

function containedPath(root: string, relativePath: string) {
  const result = resolve(root, relativePath);
  const fromRoot = relative(root, result);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) throw new Error("Invalid media path");
  return result;
}

function run(command: string, args: string[]) {
  return new Promise<string>((resolvePromise, reject) => {
    const process = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });
    Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited])
      .then(([stdout, stderr, exitCode]) => {
        if (exitCode === 0) resolvePromise(stdout);
        else reject(new Error(`${command} failed: ${stderr.trim() || `exit code ${exitCode}`}`));
      }, reject);
  });
}

async function runStage<T>(asset: MediaAsset, stage: string, work: () => Promise<T>) {
  const startedAt = performance.now();
  console.log(`[start] ${stage}: ${asset.relativePath}`);
  try {
    const result = await work();
    console.log(`[done ${((performance.now() - startedAt) / 1000).toFixed(1)}s] ${stage}: ${asset.relativePath}`);
    return result;
  } catch (error) {
    console.error(`[failed ${((performance.now() - startedAt) / 1000).toFixed(1)}s] ${stage}: ${asset.relativePath}`);
    throw error;
  }
}

function parseRate(rate: string | undefined) {
  if (!rate) return 0;
  const [numeratorText, denominatorText = "1"] = rate.split("/");
  const denominator = Number(denominatorText);
  return denominator ? Number(numeratorText) / denominator : 0;
}

async function probe(config: AppConfig, asset: MediaAsset) {
  const { sourcePath, sourceStat } = await resolveAsset(config, asset.id);
  if (asset.kind === "photo") {
    const output = await run(sipsPath, ["-g", "pixelWidth", "-g", "pixelHeight", sourcePath]);
    const width = Number(/pixelWidth:\s*(\d+)/.exec(output)?.[1]);
    const height = Number(/pixelHeight:\s*(\d+)/.exec(output)?.[1]);
    if (!width || !height) throw new Error("No photo dimensions found");
    return {
      sourcePath,
      info: {
        scanVersion: SCAN_VERSION,
        kind: asset.kind,
        source: asset.id,
        sourceMtimeMs: sourceStat.mtimeMs,
        sourceSize: sourceStat.size,
        width,
        height,
        fps: 0,
        duration: 0,
        codec: asset.id.split(".").pop()?.toLowerCase(),
        thumbnail: config.thumbnail,
      } as MediaInfo,
    };
  }
  const output = await run(ffprobePath, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,codec_name,profile,pix_fmt,avg_frame_rate,bit_rate:format=duration,bit_rate",
    "-of", "json",
    sourcePath,
  ]);
  const data = JSON.parse(output) as {
    streams?: Array<{
      width?: number;
      height?: number;
      codec_name?: string;
      profile?: string;
      pix_fmt?: string;
      avg_frame_rate?: string;
      bit_rate?: string;
    }>;
    format?: { duration?: string; bit_rate?: string };
  };
  const stream = data.streams?.[0];
  if (!stream?.width || !stream.height) throw new Error("No video stream found");

  return {
    sourcePath,
    info: {
      scanVersion: SCAN_VERSION,
      kind: asset.kind,
      source: asset.id,
      sourceMtimeMs: sourceStat.mtimeMs,
      sourceSize: sourceStat.size,
      width: stream.width,
      height: stream.height,
      fps: parseRate(stream.avg_frame_rate),
      duration: Number(data.format?.duration ?? 0),
      codec: stream.codec_name,
      profile: stream.profile,
      pixelFormat: stream.pix_fmt,
      videoBitrate: stream.bit_rate ? Number(stream.bit_rate) : undefined,
      containerBitrate: data.format?.bit_rate ? Number(data.format.bit_rate) : undefined,
      thumbnail: config.thumbnail,
    } as MediaInfo,
  };
}

function sourceAndThumbnailFresh(info: MediaInfo, config: AppConfig, mtimeMs: number, size: number) {
  return info.sourceMtimeMs === mtimeMs
    && info.sourceSize === size
    && JSON.stringify(info.thumbnail) === JSON.stringify(config.thumbnail);
}

function sourceAndProxyFresh(info: MediaInfo, config: AppConfig, mtimeMs: number, size: number) {
  return info.sourceMtimeMs === mtimeMs
    && info.sourceSize === size
    && JSON.stringify(info.proxy) === JSON.stringify(config.proxy);
}

async function scanAsset(config: AppConfig, asset: MediaAsset) {
  const { sourceStat } = await resolveAsset(config, asset.id);
  const assetRoot = containedPath(config.derivedRoot, asset.id);
  const infoPath = join(assetRoot, "info.json");
  const thumbnailPath = join(assetRoot, "thumbnail.jpg");
  const proxyPath = join(assetRoot, "proxy.mp4");
  const stabilizedProxyPath = join(assetRoot, "stabilized-proxy.mp4");
  let keepThumbnail = false;
  let keepProxy = false;
  let keepStabilizedProxy = false;

  try {
    const existing = (await Bun.file(infoPath).json()) as MediaInfo;
    keepThumbnail = existing.kind === asset.kind && await Bun.file(thumbnailPath).exists()
      && sourceAndThumbnailFresh(existing, config, sourceStat.mtimeMs, sourceStat.size);
    keepProxy = asset.kind === "photo" || !config.proxy.enabled || (
      await Bun.file(proxyPath).exists()
      && sourceAndProxyFresh(existing, config, sourceStat.mtimeMs, sourceStat.size)
    );
    keepStabilizedProxy = asset.kind === "photo" || !config.proxy.enabled || (
      await Bun.file(stabilizedProxyPath).exists()
      && sourceAndProxyFresh(existing, config, sourceStat.mtimeMs, sourceStat.size)
      && JSON.stringify(existing.stabilizedProxy) === JSON.stringify(config.proxy)
    );
    if (keepThumbnail && keepProxy && keepStabilizedProxy && existing.scanVersion === SCAN_VERSION) return "skipped" as const;
  } catch {
    // Missing or invalid scan data is rebuilt below.
  }

  const { sourcePath, info } = await runStage(asset, "metadata", () => probe(config, asset));
  const token = crypto.randomUUID();
  const temporaryThumbnail = join(assetRoot, `thumbnail-${token}.tmp.jpg`);
  const temporaryProxy = join(assetRoot, `proxy-${token}.tmp.mp4`);
  const temporaryStabilizedProxy = join(assetRoot, `stabilized-proxy-${token}.tmp.mp4`);
  const temporaryInfo = join(assetRoot, `info-${token}.tmp`);
  const seekTime = Math.min(Math.max(info.duration * 0.1, 0), 5);
  await mkdir(assetRoot, { recursive: true });

  try {
    const generation: Array<Promise<void>> = [];
    if (!keepThumbnail) {
      generation.push(runStage(asset, "thumbnail", async () => {
        if (asset.kind === "photo") {
          await run(sipsPath, [
            "-s", "format", "jpeg", "-s", "formatOptions", "85",
            "-Z", String(config.thumbnail.maxWidth), sourcePath, "--out", temporaryThumbnail,
          ]);
        } else {
          await run(ffmpegPath, [
            "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
            "-ss", String(seekTime), "-i", sourcePath,
            "-frames:v", "1",
            "-vf", `scale=${config.thumbnail.maxWidth}:-2:force_original_aspect_ratio=decrease`,
            "-q:v", String(config.thumbnail.quality),
            temporaryThumbnail,
          ]);
        }
        await rename(temporaryThumbnail, thumbnailPath);
      }));
    }
    if (asset.kind === "video" && !keepProxy) {
      generation.push(runStage(asset, "proxy", async () => {
        await run(ffmpegPath, [
          "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
          "-i", sourcePath,
          "-map", "0:v:0", "-map", "0:a:0?",
          "-vf", `scale=-2:min(${config.proxy.maxHeight}\\,ih)`,
          "-c:v", "libx264", "-preset", "veryfast", "-crf", String(config.proxy.crf),
          "-pix_fmt", "yuv420p",
          "-c:a", config.proxy.audioCodec,
          "-movflags", "+faststart",
          temporaryProxy,
        ]);
        await rename(temporaryProxy, proxyPath);
      }));
    }
    if (asset.kind === "video" && config.proxy.enabled && !keepStabilizedProxy) {
      const outputHeight = Math.min(info.height, config.proxy.maxHeight);
      const outputSize = {
        width: Math.max(2, Math.floor(info.width * outputHeight / info.height / 2) * 2),
        height: Math.max(2, Math.floor(outputHeight / 2) * 2),
      };
      // Gyroflow needs the original container's lens and per-frame gyro metadata.
      generation.push(runStage(asset, `stabilized proxy (${outputSize.width}x${outputSize.height})`, async () => {
        await runGyroflow(gyroflowPath, sourcePath, temporaryStabilizedProxy, "proxy", outputSize,
          new AbortController().signal);
        await rename(temporaryStabilizedProxy, stabilizedProxyPath);
      }));
    }
    const generationResults = await Promise.allSettled(generation);
    const failedGeneration = generationResults.find((result) => result.status === "rejected");
    if (failedGeneration?.status === "rejected") throw failedGeneration.reason;
    info.proxy = asset.kind === "video" && config.proxy.enabled ? config.proxy : undefined;
    info.stabilizedProxy = asset.kind === "video" && config.proxy.enabled ? config.proxy : undefined;
    await writeFile(temporaryInfo, `${JSON.stringify(info, null, 2)}\n`);
    await rename(temporaryInfo, infoPath);
    return keepThumbnail && keepProxy && keepStabilizedProxy ? "updated" as const : "generated" as const;
  } finally {
    await Promise.all([
      rm(temporaryThumbnail, { force: true }),
      rm(temporaryProxy, { force: true }),
      rm(temporaryStabilizedProxy, { force: true }),
      rm(temporaryInfo, { force: true }),
    ]);
  }
}

export async function scanLibrary(config: AppConfig, concurrency = 3) {
  const media = await listMedia(config);
  let completed = 0;
  const results = await concurrentMap(media, concurrency, async (asset) => {
    try {
      const result = await scanAsset(config, asset);
      console.log(`[${++completed}/${media.length}] ${result}: ${asset.relativePath}`);
      return { status: "complete", result } as const;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown scan error";
      console.error(`[${++completed}/${media.length}] failed: ${asset.relativePath}: ${message}`);
      return { status: "error", error: { asset: asset.relativePath, error: message } } as const;
    }
  });

  let generated = 0;
  let updated = 0;
  let skipped = 0;
  const errors: Array<{ asset: string; error: string }> = [];
  for (const result of results) {
    if (result.status === "error") errors.push(result.error);
    else if (result.result === "generated") generated++;
    else if (result.result === "updated") updated++;
    else skipped++;
  }
  return { total: media.length, generated, updated, skipped, errors };
}

if (import.meta.main) {
  const concurrency = Number(process.env.SCAN_CONCURRENCY ?? 3);
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("SCAN_CONCURRENCY must be a positive integer");
  console.log(`Scanning read-only library: ${config.mediaRoot}`);
  console.log(`Writing derived media to: ${config.derivedRoot}`);
  console.log(`Asset concurrency: ${concurrency} (proxy stages within each asset also run in parallel)`);
  const result = await scanLibrary(config, concurrency);
  console.log(`Scan complete: ${result.generated} generated, ${result.updated} metadata updated, ${result.skipped} fresh, ${result.errors.length} failed`);
  if (result.errors.length) process.exitCode = 1;
}
