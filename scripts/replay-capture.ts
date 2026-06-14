import { readFile } from "node:fs/promises";
import { CANDIDATE_BPH, DEFAULT_BIN_COUNT, DEFAULT_FEATURE_RATE } from "../public/defaults";
import { normalizeRow } from "../public/data";
import { foldSignal } from "../public/util";
import { createBphTracker } from "../public/tracking-fold-fit";
import type { FoldRow } from "../public/data";

type CaptureFeature = {
  name: string;
  data: number[];
};

type CaptureBatch = {
  startFrame: number;
  rawFrame: number;
  featureRate: number;
  features: CaptureFeature[];
};

type CaptureFile = {
  periodSeconds?: number;
  ready?: {
    featureRate?: number;
    bands?: string[];
  } | null;
  batches: CaptureBatch[];
};

type Frame = {
  featureFrame: number;
  bands: Float32Array;
};

const usage = () => {
  console.error("Usage: bun scripts/replay-capture.ts capture.json [periodSeconds]");
  process.exit(1);
};

const path = Bun.argv[2];
if (!path) usage();

const capture = JSON.parse(await readFile(path, "utf8")) as CaptureFile;
const firstBatch = capture.batches[0];
if (!firstBatch) {
  console.error("Capture has no batches.");
  process.exit(1);
}

const featureRate =
  Number(firstBatch.featureRate) ||
  Number(capture.ready?.featureRate) ||
  DEFAULT_FEATURE_RATE;
const periodSeconds = Number(Bun.argv[3]) || Number(capture.periodSeconds) || 10;
const cycleBeats = 2;
const frames: Frame[] = [];
let bands = capture.ready?.bands || firstBatch.features.map((feature) => feature.name);

const tracker = createBphTracker();

const trimFrames = () => {
  const framesToKeep = Math.ceil(periodSeconds * featureRate);
  if (frames.length > framesToKeep) {
    frames.splice(0, frames.length - framesToKeep);
  }
};

const foldStandardCandidate = (bph: number, bandIndex: number) => {
  return normalizeRow(
    foldSignal({
      frames,
      featureRate,
      bph,
      cycleBeats,
      binCount: DEFAULT_BIN_COUNT,
      valueAt: (frame) => frame.bands[bandIndex],
    }),
  );
};

const buildStandardFoldRows = () => {
  const rows: FoldRow[] = [];

  for (let bphIndex = 0; bphIndex < CANDIDATE_BPH.length; bphIndex += 1) {
    const bph = CANDIDATE_BPH[bphIndex];
    for (let bandIndex = 0; bandIndex < bands.length; bandIndex += 1) {
      rows.push({
        bph,
        band: bands[bandIndex],
        bins: foldStandardCandidate(bph, bandIndex),
      });
    }
  }

  return rows;
};

const addBatch = (batch: CaptureBatch) => {
  bands = batch.features.map((feature) => feature.name);
  const frameCount = batch.features[0]?.data.length || 0;

  for (let offset = 0; offset < frameCount; offset += 1) {
    const frameBands = new Float32Array(bands.length);
    for (let bandIndex = 0; bandIndex < bands.length; bandIndex += 1) {
      frameBands[bandIndex] = batch.features[bandIndex]?.data[offset] || 0;
    }
    frames.push({
      featureFrame: batch.startFrame + offset,
      bands: frameBands,
    });
  }

  trimFrames();
};

const formatNumber = (value: number | null) => (value === null ? "-" : value.toFixed(3));

let lastTrackFrame = -Infinity;
let nextPrintSecond = 1;
let tracked = 0;

console.log("seconds,standardBph,measuredBph,confidenceBph,candidates");

for (const batch of capture.batches) {
  addBatch(batch);

  const latestFrame = batch.startFrame + (batch.features[0]?.data.length || 0);
  if (latestFrame - lastTrackFrame < featureRate * 0.1 || frames.length < featureRate * 0.25) {
    continue;
  }
  lastTrackFrame = latestFrame;

  const rows = buildStandardFoldRows();
  const tracking = tracker.trackStep(
    {
      featureRate,
      cycleBeats,
      bands,
      frames,
    },
    rows,
  );
  tracked += 1;

  const seconds = latestFrame / featureRate;
  if (seconds < nextPrintSecond) continue;

  const topCandidates = tracking.candidates
    .slice()
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((candidate) => `${candidate.bph.toFixed(2)}:${candidate.score.toFixed(3)}`)
    .join(" ");

  console.log(
    [
      seconds.toFixed(1),
      formatNumber(tracking.standardBph),
      formatNumber(tracking.measuredBph),
      formatNumber(tracking.confidenceBph),
      topCandidates,
    ].join(","),
  );

  nextPrintSecond += 1;
}

const capturedSeconds = capture.batches.reduce(
  (total, batch) => total + (batch.features[0]?.data.length || 0),
  0,
) / featureRate;

console.error(
  `Replayed ${capturedSeconds.toFixed(2)}s, ${capture.batches.length} batches, ${tracked} tracking steps.`,
);
