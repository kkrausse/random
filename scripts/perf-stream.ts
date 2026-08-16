import { join } from "node:path";
import { loadConfig } from "../lib/config";
import type { MediaAsset, MediaInfo } from "../lib/types";
import { listMedia } from "../server/media";

type ScannedAsset = {
  asset: MediaAsset;
  info: MediaInfo;
};

type Measurement = {
  bytes: number;
  firstByteMs: number;
  transferMs: number;
  totalMs: number;
  megabytesPerSecond: number;
};

const baseUrl = (process.env.PERF_BASE_URL ?? "http://localhost:5173").replace(/\/$/, "");
const sampleCount = Math.max(1, Number(process.env.PERF_SAMPLES ?? 3));
const chunkSize = Math.max(1, Number(process.env.PERF_CHUNK_MB ?? 16)) * 1024 * 1024;

async function loadScannedMedia() {
  const config = await loadConfig();
  const media = await listMedia(config);
  const scanned = await Promise.all(media.map(async (asset): Promise<ScannedAsset | undefined> => {
    try {
      const info = (await Bun.file(join(config.derivedRoot, asset.id, "info.json")).json()) as MediaInfo;
      return { asset, info };
    } catch {
      return undefined;
    }
  }));
  return scanned
    .filter((item): item is ScannedAsset => item !== undefined)
    .sort((a, b) => b.info.duration - a.info.duration)
    .slice(0, sampleCount);
}

async function measureRange(asset: ScannedAsset, start: number): Promise<Measurement> {
  const targetBytes = Math.min(chunkSize, asset.info.sourceSize - start);
  const controller = new AbortController();
  const requestStarted = performance.now();
  const response = await fetch(`${baseUrl}/api/media/video?id=${encodeURIComponent(asset.asset.id)}`, {
    headers: { Range: `bytes=${start}-` },
    signal: controller.signal,
  });
  if (response.status !== 206) {
    throw new Error(`${asset.asset.filename}: expected HTTP 206, received ${response.status}`);
  }
  if (!response.body) throw new Error(`${asset.asset.filename}: response had no body`);
  const reader = response.body.getReader();
  const firstChunk = await reader.read();
  const firstByteReceived = performance.now();
  let receivedBytes = firstChunk.value?.byteLength ?? 0;
  let done = firstChunk.done;
  while (!done && receivedBytes < targetBytes) {
    const chunk = await reader.read();
    done = chunk.done;
    receivedBytes += chunk.value?.byteLength ?? 0;
  }
  const finished = performance.now();
  if (receivedBytes < targetBytes) {
    throw new Error(`${asset.asset.filename}: expected at least ${targetBytes} bytes, received ${receivedBytes}`);
  }
  if (!done) controller.abort();
  const totalMs = finished - requestStarted;
  const transferMs = finished - firstByteReceived;
  return {
    bytes: receivedBytes,
    firstByteMs: firstByteReceived - requestStarted,
    transferMs,
    totalMs,
    megabytesPerSecond: receivedBytes / 1_000_000 / (transferMs / 1000),
  };
}

function printMeasurement(label: string, measurement: Measurement, requiredMegabytesPerSecond: number) {
  const headroom = measurement.megabytesPerSecond / requiredMegabytesPerSecond;
  console.log(
    `  ${label.padEnd(12)} TTFB ${measurement.firstByteMs.toFixed(1).padStart(7)} ms  `
    + `transfer ${measurement.transferMs.toFixed(1).padStart(8)} ms  `
    + `total ${measurement.totalMs.toFixed(1).padStart(8)} ms  `
    + `${measurement.megabytesPerSecond.toFixed(1).padStart(6)} MB/s  `
    + `${headroom.toFixed(1)}x realtime`,
  );
}

const assets = await loadScannedMedia();
if (!assets.length) throw new Error("No scanned media found. Run `bun run scan` first.");

console.log(`Server: ${baseUrl}`);
console.log(`Testing ${assets.length} longest clips with ${Math.round(chunkSize / 1024 / 1024)} MiB ranges`);
console.log("Requests use an open-ended browser-style range and cancel after the sample is received.");
console.log("Repeat runs may measure macOS's file cache rather than the SMB drive.");
console.log("The middle test approximates a browser seek using the file's byte midpoint.\n");

for (const asset of assets) {
  const requiredMegabytesPerSecond = (asset.info.containerBitrate ?? asset.info.videoBitrate ?? 0) / 8_000_000;
  const middleStart = Math.max(0, Math.floor((asset.info.sourceSize - chunkSize) / 2));
  console.log(
    `${asset.asset.filename}  ${asset.info.duration.toFixed(1)}s  `
    + `realtime ${requiredMegabytesPerSecond.toFixed(1)} MB/s`,
  );
  printMeasurement("start", await measureRange(asset, 0), requiredMegabytesPerSecond);
  printMeasurement("middle seek", await measureRange(asset, middleStart), requiredMegabytesPerSecond);
  console.log();
}
