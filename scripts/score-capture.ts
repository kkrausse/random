import { readFile } from "node:fs/promises";
import { DEFAULT_FEATURE_RATE, DEFAULT_TRACKING_FOLD_BIN_COUNT } from "../public/defaults";
import { foldSignal } from "../public/util";

type CaptureFeature = {
  name: string;
  data: number[];
};

type CaptureBatch = {
  startFrame: number;
  featureRate: number;
  features: CaptureFeature[];
};

type CaptureFile = {
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

type ScoreResult = {
  name: string;
  bph: number;
  score: number;
};

const usage = () => {
  console.error("Usage: bun scripts/score-capture.ts capture.json [centerBph]");
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
const bands = capture.ready?.bands || firstBatch.features.map((feature) => feature.name);
const centerBph = Number(Bun.argv[3]) || 17964;
const cycleBeats = 2;
const binCount = DEFAULT_TRACKING_FOLD_BIN_COUNT;
const frames: Frame[] = [];

for (const batch of capture.batches) {
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
}

const average = (values: ArrayLike<number>) => {
  if (!values.length) return 0;
  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    total += values[index];
  }
  return total / values.length;
};

const averageInWindow = (values: Float32Array, center: number, radius: number) => {
  let total = 0;
  let count = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const index = (center + offset + values.length) % values.length;
    total += values[index];
    count += 1;
  }
  return total / count;
};

const smoothedBins = (values: Float32Array, radius: number) => {
  const smoothed = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    smoothed[index] = averageInWindow(values, index, radius);
  }
  return smoothed;
};

const topBandTotal = (rows: Float32Array[], scoreRow: (row: Float32Array) => number) => {
  const topScores = new Float32Array(2);

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const rowScore = scoreRow(rows[rowIndex]);
    for (let scoreIndex = 0; scoreIndex < topScores.length; scoreIndex += 1) {
      if (rowScore <= topScores[scoreIndex]) continue;

      for (let moveIndex = topScores.length - 1; moveIndex > scoreIndex; moveIndex -= 1) {
        topScores[moveIndex] = topScores[moveIndex - 1];
      }
      topScores[scoreIndex] = rowScore;
      break;
    }
  }

  return topScores[0] + topScores[1];
};

const oldPairScore = (row: Float32Array) => {
  const smoothed = smoothedBins(row, 3);
  const rowMean = average(smoothed);
  const halfCycle = Math.round(smoothed.length / 2);
  let pairTotal = 0;
  let signalTotal = 0;

  for (let index = 0; index < smoothed.length; index += 1) {
    const signal = Math.max(0, smoothed[index] - rowMean);
    const opposite = Math.max(0, smoothed[(index + halfCycle) % smoothed.length] - rowMean);
    pairTotal += signal * opposite;
    signalTotal += signal;
  }

  return signalTotal > 0 ? pairTotal / signalTotal : 0;
};

const pairedPeakScore = (row: Float32Array) => {
  const smoothed = smoothedBins(row, 2);
  const rowMean = average(smoothed);
  const halfCycle = Math.round(smoothed.length / 2);
  let bestPair = 0;
  let positiveTotal = 0;

  for (let index = 0; index < smoothed.length; index += 1) {
    const signal = Math.max(0, smoothed[index] - rowMean);
    positiveTotal += signal;
  }

  const guard = 8;
  for (let index = 0; index < smoothed.length; index += 1) {
    let localA = 0;
    let localB = 0;
    for (let offset = -guard; offset <= guard; offset += 1) {
      localA += Math.max(0, smoothed[(index + offset + smoothed.length) % smoothed.length] - rowMean);
      localB += Math.max(
        0,
        smoothed[(index + halfCycle + offset + smoothed.length) % smoothed.length] - rowMean,
      );
    }
    bestPair = Math.max(bestPair, Math.min(localA, localB));
  }

  return positiveTotal > 0 ? (bestPair * bestPair) / positiveTotal : 0;
};

const peakContrastScore = (row: Float32Array) => {
  const smoothed = smoothedBins(row, 2);
  const rowMean = average(smoothed);
  let variance = 0;
  let peak = 0;

  for (let index = 0; index < smoothed.length; index += 1) {
    const value = smoothed[index];
    const signal = Math.max(0, value - rowMean);
    peak = Math.max(peak, signal);
    const diff = value - rowMean;
    variance += diff * diff;
  }

  const rowStd = Math.sqrt(variance / Math.max(1, smoothed.length));
  return rowStd > 0 ? peak / rowStd : 0;
};

const foldRows = (bph: number) => {
  const rows: Float32Array[] = [];
  for (let bandIndex = 0; bandIndex < bands.length; bandIndex += 1) {
    rows.push(
      foldSignal({
        frames,
        featureRate,
        bph,
        cycleBeats,
        binCount,
        valueAt: (frame) => frame.bands[bandIndex],
      }),
    );
  }
  return rows;
};

const scoreAt = (bph: number) => {
  const rows = foldRows(bph);
  return [
    {
      name: "oldPair",
      bph,
      score: topBandTotal(rows, oldPairScore),
    },
    {
      name: "pairedPeak",
      bph,
      score: topBandTotal(rows, pairedPeakScore),
    },
    {
      name: "peakContrast",
      bph,
      score: topBandTotal(rows, peakContrastScore),
    },
  ];
};

const results = new Map<string, ScoreResult[]>();
for (let offset = -80; offset <= 80; offset += 0.5) {
  for (const result of scoreAt(centerBph + offset)) {
    const values = results.get(result.name) || [];
    values.push(result);
    results.set(result.name, values);
  }
}

for (const [name, values] of results) {
  const byBph = values.slice().sort((left, right) => left.bph - right.bph);
  const sorted = values.slice().sort((left, right) => right.score - left.score);
  const best = sorted[0];
  const second = sorted.find((value) => Math.abs(value.bph - best.bph) >= 2) || sorted[1];
  const tenth = sorted[Math.min(9, sorted.length - 1)];
  const bestIndex = byBph.findIndex((value) => value.bph === best.bph);
  const localMinBph = best.bph - 20;
  const localMaxBph = best.bph + 20;
  let localPeakCount = 0;
  let outwardViolations = 0;

  for (let index = 1; index < byBph.length - 1; index += 1) {
    const value = byBph[index];
    if (value.bph < localMinBph || value.bph > localMaxBph) continue;
    if (value.score > byBph[index - 1].score && value.score > byBph[index + 1].score) {
      localPeakCount += 1;
    }
  }

  for (let index = bestIndex - 1; index > 0; index -= 1) {
    if (byBph[index].bph < localMinBph) break;
    if (byBph[index - 1].score > byBph[index].score) outwardViolations += 1;
  }

  for (let index = bestIndex + 1; index < byBph.length - 1; index += 1) {
    if (byBph[index].bph > localMaxBph) break;
    if (byBph[index + 1].score > byBph[index].score) outwardViolations += 1;
  }

  const spread = best.score - tenth.score;
  const margin = second ? best.score - second.score : 0;

  console.log(
    [
      name,
      `best=${best.bph.toFixed(1)}:${best.score.toFixed(4)}`,
      `second2bph=${second.bph.toFixed(1)}:${second.score.toFixed(4)}`,
      `margin=${margin.toFixed(4)}`,
      `top10spread=${spread.toFixed(4)}`,
      `localPeaks20=${localPeakCount}`,
      `outwardViolations20=${outwardViolations}`,
    ].join(","),
  );

  if (name === "pairedPeak") {
    const local = byBph
      .filter((value) => Math.abs(value.bph - best.bph) <= 5)
      .map((value) => `${value.bph.toFixed(1)}:${value.score.toFixed(1)}`)
      .join(" ");
    console.log(`pairedPeakLocal,${local}`);
  }
}
