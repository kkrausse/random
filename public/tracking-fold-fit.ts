import { CANDIDATE_BPH } from "./defaults";
import { clamp, normalizeRow } from "./data";
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

const TRACKING_BIN_COUNT = 256;
const MIN_TRACKING_SECONDS = 2;
const MIN_ERROR_BPH = 5;
const INITIAL_ERROR_BPH = 300;
const MAX_ERROR_BPH = 300;
const SEARCH_OFFSETS = [-1, -0.5, -0.25, 0, 0.25, 0.5, 1];

const EMPTY_TRACKING_STATE: TrackingState = {
  standardBph: null,
  measuredBph: null,
  confidenceBph: null,
  score: 0,
};

const average = (values: number[]) => {
  if (!values.length) return 0;
  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    total += values[index];
  }
  return total / values.length;
};

const maxInWindow = (values: Float32Array, center: number, radius: number) => {
  let peak = -Infinity;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const index = (center + offset + values.length) % values.length;
    peak = Math.max(peak, values[index]);
  }
  return peak;
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

const rowPacketScore = (bins: Float32Array) => {
  if (!bins.length) return 0;

  const primary = strongestBin(bins);
  const oppositeBin = (primary.bin + Math.round(bins.length / 2)) % bins.length;
  const opposite = maxInWindow(bins, oppositeBin, Math.max(2, Math.round(bins.length / 24)));
  const weakerPacket = Math.min(primary.value, opposite);
  const strongerPacket = Math.max(primary.value, opposite);

  return Math.max(0, weakerPacket + strongerPacket * 0.35);
};

const scoreRows = (rows: Float32Array[]) => {
  const scores = rows.map(rowPacketScore).filter((score) => score > 0);
  scores.sort((a, b) => b - a);

  const usefulScores = scores.slice(0, Math.min(3, scores.length));
  return average(usefulScores);
};

const scoreStandard = (bph: number, foldRows: FoldRow[]) => {
  const rows = foldRows.filter((row) => row.bph === bph).map((row) => row.bins);
  return scoreRows(rows);
};

const chooseStandardBph = (trackingState: TrackingState, foldRows: FoldRow[]) => {
  let bestBph: number | null = null;
  let bestScore = -Infinity;

  for (let index = 0; index < CANDIDATE_BPH.length; index += 1) {
    const bph = CANDIDATE_BPH[index];
    const score = scoreStandard(bph, foldRows);
    if (score > bestScore) {
      bestBph = bph;
      bestScore = score;
    }
  }

  if (trackingState.standardBph && bestBph) {
    const previousScore = scoreStandard(trackingState.standardBph, foldRows);
    if (previousScore > 0 && bestScore < previousScore * 1.15) {
      return trackingState.standardBph;
    }
  }

  return bestBph;
};

const foldTrackingCandidate = (
  globalState: TrackingGlobalState,
  bph: number,
  bandIndex: number,
) => {
  const folded = new Float32Array(TRACKING_BIN_COUNT);
  const intervalSeconds = (3600 / bph) * globalState.cycleBeats;

  for (let index = 0; index < globalState.frames.length; index += 1) {
    const frame = globalState.frames[index];
    const seconds = frame.featureFrame / globalState.featureRate;
    const phase = (seconds % intervalSeconds) / intervalSeconds;
    const bin = Math.min(TRACKING_BIN_COUNT - 1, Math.floor(phase * TRACKING_BIN_COUNT));
    folded[bin] += frame.bands[bandIndex];
  }

  return normalizeRow(folded);
};

const scoreTrialBph = (globalState: TrackingGlobalState, bph: number) => {
  const rows: Float32Array[] = [];
  for (let bandIndex = 0; bandIndex < globalState.bands.length; bandIndex += 1) {
    rows.push(foldTrackingCandidate(globalState, bph, bandIndex));
  }
  return scoreRows(rows);
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

  for (let index = 0; index < SEARCH_OFFSETS.length; index += 1) {
    const offset = SEARCH_OFFSETS[index];
    const bph = clamp(
      center + confidenceBph * offset,
      standardBph - MAX_ERROR_BPH,
      standardBph + MAX_ERROR_BPH,
    );
    const score = scoreTrialBph(globalState, bph);
    if (score > bestScore) {
      bestBph = bph;
      bestScore = score;
      bestOffset = offset;
    }
  }

  return { measuredBph: bestBph, score: bestScore, edgeHit: Math.abs(bestOffset) === 1 };
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

  const standardBph = chooseStandardBph(trackingState, foldRows);
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
