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
const MIN_ERROR_BPH = 0.1;
const INITIAL_ERROR_BPH = 300;
const MAX_ERROR_BPH = 300;
const EDGE_SCORE_RATIO = 1.05;
const EDGE_SCORE_MARGIN = 0.25;
const CURVE_DROP_RATIO = 1.01;
const CURVE_DROP_MARGIN = 0.05;
const PEAK_PROMINENCE_RATIO = 1.001;
const PEAK_PROMINENCE_MARGIN = 0.000002;
const COMPETING_PEAK_RATIO = 0.995;
const COMPETING_PEAK_MARGIN = 0.12;
const OUTWARD_VIOLATION_RATIO = 1.001;
const OUTWARD_VIOLATION_MARGIN = 0.04;
const MAX_OUTWARD_VIOLATIONS = 2;
const PACKET_AVERAGE_SECONDS = 0.00005;
const PEAK_WINDOW_SECONDS = 0.00015;
const EXPAND_ERROR_SCALE = 1.4;
const SHRINK_ERROR_SCALE = 0.7;
const UNCERTAIN_ERROR_SCALE = 1.1;
const SEARCH_OFFSETS = Array.from({ length: 11 }, (_, index) => (index - 5) / 5);
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

const peakWindowRadius = (binCount: number, bph: number, cycleBeats: number) => {
  const cycleSeconds = (3600 / bph) * cycleBeats;
  return Math.max(1, Math.round((PEAK_WINDOW_SECONDS / cycleSeconds) * binCount));
};

const circularWindowSums = (values: Float32Array, radius: number) => {
  const sums = new Float32Array(values.length);
  if (!values.length) return sums;

  let total = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    total += values[(offset + values.length) % values.length];
  }

  for (let index = 0; index < values.length; index += 1) {
    sums[index] = total;
    const removed = (index - radius + values.length) % values.length;
    const added = (index + radius + 1) % values.length;
    total += values[added] - values[removed];
  }

  return sums;
};

const rowPacketScore = (bins: Float32Array, bph: number, cycleBeats: number): RowScore => {
  if (!bins.length) {
    return {
      score: 0,
    };
  }

  const packetRadius = packetAverageRadius(bins.length, bph, cycleBeats);
  const peakRadius = peakWindowRadius(bins.length, bph, cycleBeats);
  const smoothed = smoothedBins(bins, packetRadius);
  const rowMean = average(smoothed);
  const halfCycle = Math.round(smoothed.length / 2);
  const signal = new Float32Array(smoothed.length);
  let signalTotal = 0;

  for (let index = 0; index < smoothed.length; index += 1) {
    signal[index] = Math.max(0, smoothed[index] - rowMean);
    signalTotal += signal[index];
  }

  if (signalTotal <= 0) {
    return {
      score: 0,
    };
  }

  const peakSums = circularWindowSums(signal, peakRadius);
  let bestPair = 0;

  for (let index = 0; index < peakSums.length; index += 1) {
    const opposite = peakSums[(index + halfCycle) % peakSums.length];
    bestPair = Math.max(bestPair, Math.min(peakSums[index], opposite));
  }

  return {
    score: (bestPair * bestPair) / signalTotal,
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

const scoreIsBetter = (
  score: number,
  baseline: number,
  ratio: number,
  margin: number,
) => {
  return score >= baseline * ratio && score >= baseline + margin;
};

const scoreCanCompete = (score: number, bestScore: number) => {
  return (
    score >= bestScore * COMPETING_PEAK_RATIO ||
    score >= bestScore - COMPETING_PEAK_MARGIN
  );
};

const isProminentPeak = (candidates: TrackingCandidate[], index: number) => {
  if (index <= 0 || index >= candidates.length - 1) return false;

  const score = candidates[index].score;
  const neighborScore = Math.max(candidates[index - 1].score, candidates[index + 1].score);

  return scoreIsBetter(score, neighborScore, PEAK_PROMINENCE_RATIO, PEAK_PROMINENCE_MARGIN);
};

const countCompetingPeaks = (candidates: TrackingCandidate[], bestScore: number) => {
  let count = 0;

  for (let index = 1; index < candidates.length - 1; index += 1) {
    if (!isProminentPeak(candidates, index)) continue;
    if (!scoreCanCompete(candidates[index].score, bestScore)) continue;
    count += 1;
  }

  return count;
};

const countOutwardViolations = (candidates: TrackingCandidate[], bestIndex: number) => {
  let count = 0;

  for (let index = bestIndex - 1; index > 0; index -= 1) {
    const closer = candidates[index].score;
    const farther = candidates[index - 1].score;
    if (scoreIsBetter(farther, closer, OUTWARD_VIOLATION_RATIO, OUTWARD_VIOLATION_MARGIN)) {
      count += 1;
    }
  }

  for (let index = bestIndex + 1; index < candidates.length - 1; index += 1) {
    const closer = candidates[index].score;
    const farther = candidates[index + 1].score;
    if (scoreIsBetter(farther, closer, OUTWARD_VIOLATION_RATIO, OUTWARD_VIOLATION_MARGIN)) {
      count += 1;
    }
  }

  return count;
};

const curveDecision = (
  candidates: TrackingCandidate[],
  bestIndex: number,
  centerIndex: number,
) => {
  const bestScore = candidates[bestIndex].score;
  const centerScore = candidates[centerIndex].score;
  const edgeHit = bestIndex === 0 || bestIndex === candidates.length - 1;
  const strongEdgeHit =
    edgeHit &&
    scoreIsBetter(bestScore, centerScore, EDGE_SCORE_RATIO, EDGE_SCORE_MARGIN);

  if (edgeHit) {
    return {
      measuredIndex: strongEdgeHit ? bestIndex : centerIndex,
      errorScale: strongEdgeHit ? EXPAND_ERROR_SCALE : 1,
    };
  }

  const bestBeatsCenter = bestIndex === centerIndex || bestScore > centerScore;
  const bestBeatsEdges =
    scoreIsBetter(bestScore, candidates[0].score, CURVE_DROP_RATIO, CURVE_DROP_MARGIN) &&
    scoreIsBetter(
      bestScore,
      candidates[candidates.length - 1].score,
      CURVE_DROP_RATIO,
      CURVE_DROP_MARGIN,
    );
  const clearPeak =
    isProminentPeak(candidates, bestIndex) &&
    countCompetingPeaks(candidates, bestScore) === 1 &&
    countOutwardViolations(candidates, bestIndex) <= MAX_OUTWARD_VIOLATIONS &&
    bestBeatsEdges;

  if (bestBeatsCenter) {
    return {
      measuredIndex: bestIndex,
      errorScale: clearPeak ? SHRINK_ERROR_SCALE : 1,
    };
  }

  return {
    measuredIndex: centerIndex,
    errorScale: UNCERTAIN_ERROR_SCALE,
  };
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
  let bestScore = -Infinity;
  let bestIndex = 0;
  let centerIndex = 0;
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
      offset,
    });
    if (offset === 0) {
      centerIndex = index;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  const decision = curveDecision(candidates, bestIndex, centerIndex);
  const measuredCandidate = candidates[decision.measuredIndex];
  candidates[bestIndex].best = true;
  measuredCandidate.selected = true;

  return {
    measuredBph: measuredCandidate.bph,
    score: measuredCandidate.score,
    errorScale: decision.errorScale,
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

  return previous.measuredBph * 0.25 + measuredBph * 0.75;
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
