import { CANDIDATE_BPH } from "./defaults";
import { clamp } from "./data";
import { foldSignal } from "./util";
import type { FoldRow, Tracking } from "./data";

export type TrackingFrame = {
  featureFrame: number;
  bands: Float32Array;
};

export type TrackingGlobalState = {
  featureRate: number;
  cycleBeats: number;
  bands: string[];
  frames: TrackingFrame[];
};

export type TrackingState = Tracking & {
  score: number;
};

export type ActualBphTracker = {
  trackStep(globalState: TrackingGlobalState, foldRows: FoldRow[]): Tracking;
};

type RowScore = {
  score: number;
  debug: Record<string, number>;
};

const TRACKING_BIN_COUNT = 4096;
const MIN_TRACKING_SECONDS = 2;
const MIN_ERROR_BPH = 2;
const INITIAL_ERROR_BPH = 300;
const MAX_ERROR_BPH = 300;
const EDGE_SCORE_RATIO = 1.05;
const EDGE_SCORE_MARGIN = 0.25;
const BACKGROUND_DELTA = 1;
const PACKET_AVERAGE_SECONDS = 0.003;
const SEARCH_OFFSETS = Array.from({ length: 21 }, (_, index) => (index - 10) / 10);

const EMPTY_TRACKING_STATE: TrackingState = {
  standardBph: null,
  measuredBph: null,
  confidenceBph: null,
  score: 0,
};

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

const strongestBin = (values: Float32Array) => {
  let bin = 0;
  let value = -Infinity;

  for (let index = 0; index < values.length; index += 1) {
    if (values[index] > value) {
      bin = index;
      value = values[index];
    }
  }

  return { bin, value };
};

const strongestBinInWindow = (values: Float32Array, center: number, radius: number) => {
  let bin = center;
  let value = -Infinity;

  for (let offset = -radius; offset <= radius; offset += 1) {
    const index = (center + offset + values.length) % values.length;
    if (values[index] > value) {
      bin = index;
      value = values[index];
    }
  }

  return { bin, value };
};

const belowDeltaRatio = (values: Float32Array, delta: number) => {
  if (!values.length) return 0;

  let count = 0;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] < delta) {
      count += 1;
    }
  }
  return count / values.length;
};

const packetAverageRadius = (binCount: number, bph: number, cycleBeats: number) => {
  const cycleSeconds = (3600 / bph) * cycleBeats;
  return Math.max(1, Math.round((PACKET_AVERAGE_SECONDS / cycleSeconds) * binCount * 0.5));
};

const rowPacketScore = (bins: Float32Array, bph: number, cycleBeats: number): RowScore => {
  if (!bins.length) {
    return {
      score: 0,
      debug: {},
    };
  }

  const primary = strongestBin(bins);
  const oppositeBin = (primary.bin + Math.round(bins.length / 2)) % bins.length;
  const opposite = strongestBinInWindow(
    bins,
    oppositeBin,
    Math.max(2, Math.round(bins.length * 0.02)),
  );
  const packetRadius = packetAverageRadius(bins.length, bph, cycleBeats);
  const primaryPacket = averageInWindow(bins, primary.bin, packetRadius);
  const oppositePacket = averageInWindow(bins, opposite.bin, packetRadius);
  const weakerPacket = Math.min(primaryPacket, oppositePacket);
  const strongerPacket = Math.max(primaryPacket, oppositePacket);
  const packetScore = weakerPacket + strongerPacket * 0.35;
  const rowMean = average(bins);
  const sparseBackground = belowDeltaRatio(bins, (weakerPacket + strongerPacket) / 5);

  return {
    score: Math.max(0, packetScore * (1 + sparseBackground)),
    debug: {
      sparseBackground,
      rowMean,
      packetRadius,
      primaryPacket,
      oppositePacket,
    },
  };
};

const sumRows = (rows: Float32Array[]) => {
  if (!rows.length) return new Float32Array();

  const summed = new Float32Array(rows[0].length);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    for (let bin = 0; bin < summed.length; bin += 1) {
      summed[bin] += row[bin];
    }
  }
  return summed;
};

const scoreRows = (rows: Float32Array[], bph: number, cycleBeats: number) => {
  return rowPacketScore(sumRows(rows), bph, cycleBeats);
};

const scoreStandard = (bph: number, foldRows: FoldRow[], cycleBeats: number) => {
  const rows = foldRows.filter((row) => row.bph === bph).map((row) => row.bins);
  return scoreRows(rows, bph, cycleBeats).score;
};

const chooseStandardBph = (foldRows: FoldRow[], cycleBeats: number) => {
  let bestBph: number | null = null;
  let bestScore = -Infinity;

  for (let index = 0; index < CANDIDATE_BPH.length; index += 1) {
    const bph = CANDIDATE_BPH[index];
    const score = scoreStandard(bph, foldRows, cycleBeats);
    if (score > bestScore) {
      bestBph = bph;
      bestScore = score;
    }
  }

  return bestBph;
};

const foldTrackingCandidate = (
  globalState: TrackingGlobalState,
  bph: number,
  bandIndex: number,
) => {
  return foldSignal({
    frames: globalState.frames,
    featureRate: globalState.featureRate,
    bph,
    cycleBeats: globalState.cycleBeats,
    binCount: TRACKING_BIN_COUNT,
    valueAt: (frame) => frame.bands[bandIndex],
  });
};

const scoreTrialBph = (globalState: TrackingGlobalState, bph: number) => {
  const rows: Float32Array[] = [];
  for (let bandIndex = 0; bandIndex < globalState.bands.length; bandIndex += 1) {
    rows.push(foldTrackingCandidate(globalState, bph, bandIndex));
  }
  return scoreRows(rows, bph, globalState.cycleBeats);
};

const searchMeasuredBph = (
  trackingState: TrackingState,
  globalState: TrackingGlobalState,
  standardBph: number,
) => {
  const confidenceBph =
    trackingState.standardBph === standardBph && trackingState.confidenceBph
      ? trackingState.confidenceBph
      : INITIAL_ERROR_BPH;
  const center =
    trackingState.standardBph === standardBph && trackingState.measuredBph
      ? trackingState.measuredBph
      : standardBph;
  let bestBph = center;
  let bestScore = -Infinity;
  let bestOffset = 0;
  let centerScore = -Infinity;
  const trials: Record<string, number>[] = [];

  for (let index = 0; index < SEARCH_OFFSETS.length; index += 1) {
    const offset = SEARCH_OFFSETS[index];
    const bph = clamp(
      center + confidenceBph * offset,
      standardBph - MAX_ERROR_BPH,
      standardBph + MAX_ERROR_BPH,
    );
    const trialScore = scoreTrialBph(globalState, bph);
    const score = trialScore.score;
    trials.push({
      index,
      bph,
      score,
      ...trialScore.debug,
    });
    if (offset === 0) {
      centerScore = score;
    }
    if (score > bestScore) {
      bestBph = bph;
      bestScore = score;
      bestOffset = offset;
    }
  }

  const edgeHit = Math.abs(bestOffset) === 1;
  const strongEdgeHit =
    edgeHit &&
    bestScore >= centerScore * EDGE_SCORE_RATIO &&
    bestScore >= centerScore + EDGE_SCORE_MARGIN;

  const selected = edgeHit && !strongEdgeHit
    ? { bph: center, score: centerScore, offset: 0, edgeHit: false }
    : { bph: bestBph, score: bestScore, offset: bestOffset, edgeHit: strongEdgeHit };

  console.log("tracking search", {
    standardBph,
    center,
    confidenceBph,
    selected,
  });
  console.table(trials);

  if (edgeHit && !strongEdgeHit) {
    return { measuredBph: center, score: centerScore, edgeHit: false };
  }

  return { measuredBph: bestBph, score: bestScore, edgeHit: strongEdgeHit };
};

const smoothMeasuredBph = (
  previous: TrackingState,
  standardBph: number,
  measuredBph: number,
) => {
  if (previous.standardBph !== standardBph || !previous.measuredBph) {
    return measuredBph;
  }

  return previous.measuredBph * 0.75 + measuredBph * 0.25;
};

const nextConfidenceBph = (
  previous: TrackingState,
  standardBph: number,
  edgeHit: boolean,
) => {
  const current =
    previous.standardBph === standardBph && previous.confidenceBph
      ? previous.confidenceBph
      : INITIAL_ERROR_BPH;

  if (edgeHit) {
    return clamp(current * 1.5, MIN_ERROR_BPH, MAX_ERROR_BPH);
  }

  return clamp(current * 0.75, MIN_ERROR_BPH, MAX_ERROR_BPH);
};

const trackStep = (
  trackingState: TrackingState,
  globalState: TrackingGlobalState,
  foldRows: FoldRow[],
): TrackingState => {
  const availableSeconds = globalState.frames.length / globalState.featureRate;
  if (
    availableSeconds < MIN_TRACKING_SECONDS ||
    globalState.bands.length === 0 ||
    foldRows.length === 0
  ) {
    return trackingState;
  }

  const standardBph = chooseStandardBph(foldRows, globalState.cycleBeats);
  if (!standardBph) {
    return trackingState;
  }

  const result = searchMeasuredBph(trackingState, globalState, standardBph);
  const measuredBph = smoothMeasuredBph(trackingState, standardBph, result.measuredBph);
  const confidenceBph = nextConfidenceBph(trackingState, standardBph, result.edgeHit);

  return {
    standardBph,
    measuredBph,
    confidenceBph,
    score: result.score,
  };
};

export const createBphTracker = (): ActualBphTracker => {
  let trackingState = EMPTY_TRACKING_STATE;

  return {
    trackStep(globalState, foldRows) {
      trackingState = trackStep(trackingState, globalState, foldRows);
      return {
        standardBph: trackingState.standardBph,
        measuredBph: trackingState.measuredBph,
        confidenceBph: trackingState.confidenceBph,
      };
    },
  };
};
