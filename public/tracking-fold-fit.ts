import { CANDIDATE_BPH, DEFAULT_TRACKING_FOLD_BIN_COUNT } from "./defaults";
import { clamp } from "./data";
import { foldSignal } from "./util";
import type { FoldRow, Tracking, TrackingCandidate } from "./data";

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
};

const MIN_TRACKING_SECONDS = 2;
const MIN_ERROR_BPH = 0.5;
const INITIAL_ERROR_BPH = 300;
const MAX_ERROR_BPH = 300;
const EDGE_SCORE_RATIO = 1.05;
const EDGE_SCORE_MARGIN = 0.25;
const PACKET_AVERAGE_SECONDS = 0.001;
const EXPAND_ERROR_SCALE = 1.5;
const SHRINK_ERROR_SCALE = 0.9;
const SEARCH_OFFSETS = Array.from({ length: 21 }, (_, index) => (index - 10) / 10);
const SCORE_ROW_COUNT = 2;

const EMPTY_TRACKING_STATE: TrackingState = {
  standardBph: null,
  measuredBph: null,
  confidenceBph: null,
  candidates: [],
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

const smoothedBins = (values: Float32Array, radius: number) => {
  const smoothed = new Float32Array(values.length);

  for (let index = 0; index < values.length; index += 1) {
    smoothed[index] = averageInWindow(values, index, radius);
  }

  return smoothed;
};

const packetAverageRadius = (binCount: number, bph: number, cycleBeats: number) => {
  const cycleSeconds = (3600 / bph) * cycleBeats;
  return Math.max(1, Math.round((PACKET_AVERAGE_SECONDS / cycleSeconds) * binCount * 0.5));
};

const rowPacketScore = (bins: Float32Array, bph: number, cycleBeats: number): RowScore => {
  if (!bins.length) {
    return {
      score: 0,
    };
  }

  const packetRadius = packetAverageRadius(bins.length, bph, cycleBeats);
  const smoothed = smoothedBins(bins, packetRadius);
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

  return {
    score: signalTotal > 0 ? pairTotal / signalTotal : 0,
  };
};

const scoreRows = (rows: Float32Array[], bph: number, cycleBeats: number) => {
  const topScores = new Float32Array(SCORE_ROW_COUNT);

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const rowScore = rowPacketScore(rows[rowIndex], bph, cycleBeats).score;

    for (let scoreIndex = 0; scoreIndex < topScores.length; scoreIndex += 1) {
      if (rowScore <= topScores[scoreIndex]) continue;

      for (let moveIndex = topScores.length - 1; moveIndex > scoreIndex; moveIndex -= 1) {
        topScores[moveIndex] = topScores[moveIndex - 1];
      }
      topScores[scoreIndex] = rowScore;
      break;
    }
  }

  let score = 0;
  for (let index = 0; index < topScores.length; index += 1) {
    score += topScores[index];
  }

  return { score };
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
    binCount: DEFAULT_TRACKING_FOLD_BIN_COUNT,
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
  const candidates: TrackingCandidate[] = [];

  for (let index = 0; index < SEARCH_OFFSETS.length; index += 1) {
    const offset = SEARCH_OFFSETS[index];
    const bph = clamp(
      center + confidenceBph * offset,
      standardBph - MAX_ERROR_BPH,
      standardBph + MAX_ERROR_BPH,
    );
    const trialScore = scoreTrialBph(globalState, bph);
    const score = trialScore.score;
    candidates.push({
      bph,
      score,
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

  if (edgeHit && !strongEdgeHit) {
    return { measuredBph: center, score: centerScore, errorScale: 1, candidates };
  }

  return {
    measuredBph: bestBph,
    score: bestScore,
    errorScale: strongEdgeHit ? EXPAND_ERROR_SCALE : SHRINK_ERROR_SCALE,
    candidates,
  };
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
  errorScale: number,
) => {
  const current =
    previous.standardBph === standardBph && previous.confidenceBph
      ? previous.confidenceBph
      : INITIAL_ERROR_BPH;

  return clamp(current * errorScale, MIN_ERROR_BPH, MAX_ERROR_BPH);
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
  const confidenceBph = nextConfidenceBph(trackingState, standardBph, result.errorScale);

  return {
    standardBph,
    measuredBph,
    confidenceBph,
    candidates: result.candidates,
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
        candidates: trackingState.candidates,
      };
    },
  };
};
