import { CANDIDATE_BPH, DEFAULT_TRACKING_FOLD_BIN_COUNT } from "./defaults";
import { clamp } from "./data";
import { foldSignal } from "./util";
import type { FoldRow, Tracking, TrackingCandidate } from "./data";

export type TrackingFrame = {
  featureFrame: number;
  seconds?: number;
  bands: Float32Array;
};

export type TrackingGlobalState = {
  featureRate: number;
  cycleBeats: number;
  bands: string[];
  frames: TrackingFrame[];
};

export type ActualBphTracker = {
  trackStep(globalState: TrackingGlobalState, foldRows: FoldRow[]): Tracking;
};

type TrackingState = Tracking;

const MIN_TRACKING_SECONDS = 2;
const MIN_ERROR_BPH = 0.1;
const INITIAL_ERROR_BPH = 300;
const MAX_ERROR_BPH = 300;
const SEARCH_OFFSETS = [-1, 0, 1];

const EMPTY_STATE: TrackingState = {
  standardBph: null,
  measuredBph: null,
  confidenceBph: null,
  candidates: [],
};

const rowScore = (bins: Float32Array) => {
  if (!bins.length) return 0;

  let max = -Infinity;
  for (let index = 0; index < bins.length; index += 1) {
    const value = bins[index];
    if (value > max) max = value;
  }

  return max;
};

const standardScore = (bph: number, foldRows: FoldRow[]) => {
  let score = 0;
  for (let index = 0; index < foldRows.length; index += 1) {
    const row = foldRows[index];
    if (row.bph === bph) score += rowScore(row.bins);
  }
  return score;
};

const chooseStandardBph = (foldRows: FoldRow[]) => {
  let bestBph: number | null = null;
  let bestScore = -Infinity;

  for (let index = 0; index < CANDIDATE_BPH.length; index += 1) {
    const bph = CANDIDATE_BPH[index];
    const score = standardScore(bph, foldRows);
    if (score > bestScore) {
      bestBph = bph;
      bestScore = score;
    }
  }

  return bestBph;
};

const trialScore = (globalState: TrackingGlobalState, bph: number) => {
  let score = 0;
  for (let bandIndex = 0; bandIndex < globalState.bands.length; bandIndex += 1) {
    score += rowScore(
      foldSignal({
        frames: globalState.frames,
        featureRate: globalState.featureRate,
        bph,
        cycleBeats: globalState.cycleBeats,
        binCount: DEFAULT_TRACKING_FOLD_BIN_COUNT,
        applyCycleCoherence: false,
        valueAt: (frame) => frame.bands[bandIndex],
      }),
    );
  }
  return score;
};

const buildCandidates = (
  state: TrackingState,
  globalState: TrackingGlobalState,
  standardBph: number,
): TrackingCandidate[] => {
  const sameStandard = state.standardBph === standardBph;
  const center = sameStandard && state.measuredBph ? state.measuredBph : standardBph;
  const error = sameStandard && state.confidenceBph ? state.confidenceBph : INITIAL_ERROR_BPH;

  return SEARCH_OFFSETS.map((offset) => {
    const bph = clamp(
      center + offset * error,
      standardBph - MAX_ERROR_BPH,
      standardBph + MAX_ERROR_BPH,
    );
    return { bph, offset, score: trialScore(globalState, bph) };
  });
};

const bestCandidateIndex = (candidates: TrackingCandidate[]) => {
  let bestIndex = 0;
  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const best = candidates[bestIndex];
    if (
      candidate.score > best.score ||
      (candidate.score === best.score &&
        Math.abs(candidate.offset || 0) < Math.abs(best.offset || 0))
    ) {
      bestIndex = index;
    }
  }
  return bestIndex;
};

const trackStep = (
  state: TrackingState,
  globalState: TrackingGlobalState,
  foldRows: FoldRow[],
): TrackingState => {
  if (
    globalState.frames.length / globalState.featureRate < MIN_TRACKING_SECONDS ||
    globalState.bands.length === 0 ||
    foldRows.length === 0
  ) {
    return state;
  }

  const standardBph = chooseStandardBph(foldRows);
  if (!standardBph) return state;

  const previousError =
    state.standardBph === standardBph && state.confidenceBph
      ? state.confidenceBph
      : INITIAL_ERROR_BPH;
  const candidates = buildCandidates(state, globalState, standardBph);
  const bestIndex = bestCandidateIndex(candidates);
  const nextError = candidates[bestIndex].offset === 0 ? previousError / 2 : previousError;

  candidates[bestIndex].best = true;
  candidates[bestIndex].selected = true;

  return {
    standardBph,
    measuredBph: candidates[bestIndex].bph,
    confidenceBph: clamp(nextError, MIN_ERROR_BPH, MAX_ERROR_BPH),
    candidates,
  };
};

export const createBphTracker = (): ActualBphTracker => {
  let state = EMPTY_STATE;

  return {
    trackStep(globalState, foldRows) {
      state = trackStep(state, globalState, foldRows);
      return state;
    },
  };
};
