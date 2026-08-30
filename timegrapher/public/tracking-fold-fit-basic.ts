import { CANDIDATE_BPH, DEFAULT_TRACKING_FOLD_BIN_COUNT } from "./defaults";
import { clamp, normalizeRow } from "./data";
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

type StandardChoice = {
  standardBph: number;
  bandIndexes: number[];
};
type StandardScore = StandardChoice & {
  score: number;
};
type StandardSelection = {
  standard: StandardChoice | null;
  standardScoreHistory: StandardScore[][];
};
type TrackingState = Tracking & {
  standardScoreHistory: StandardScore[][];
};

const MIN_TRACKING_SECONDS = 2;
const MIN_ERROR_BPH = 0.5;
const INITIAL_ERROR_BPH = 300;
const MAX_ERROR_BPH = 300;
const TRACKING_BAND_COUNT = 2;
const STANDARD_SCORE_HISTORY_COUNT = 5;
const STANDARD_SWITCH_SCORE_RATIO = 1.02;
const SEARCH_STEPS_PER_SIDE = 4;
const SEARCH_OFFSETS = Array.from(
  { length: SEARCH_STEPS_PER_SIDE * 2 + 1 },
  (_, index) => (index - SEARCH_STEPS_PER_SIDE) / SEARCH_STEPS_PER_SIDE,
);

const EMPTY_STATE: TrackingState = {
  standardBph: null,
  measuredBph: null,
  confidenceBph: null,
  candidates: [],
  standardScoreHistory: [],
};

const rowScore = (bins: Float32Array) => {
  if (bins.length < 2) return 0;

  const row = normalizeRow(bins);
  const half = Math.floor(bins.length / 2);
  const spacingSlack = Math.max(1, Math.round(bins.length * 0.05));
  let bestPair = 0;
  let total = 0;

  for (let index = 0; index < half + 3; index += 1) {
    const first = Math.max(0, row[index] + row[index + 1]);
    total += first;

    for (let offset = -spacingSlack; offset <= spacingSlack; offset += 1) {
      const oppositeIndex = (index + half + offset + row.length) % row.length;
      const second = Math.max(0, row[oppositeIndex] + row[(oppositeIndex + 1) % row.length]);
      bestPair = Math.max(bestPair, first * second);
    }
  }

  if (!total) return 0;
  return bestPair / total;
};

const standardScore = (bph: number, foldRows: FoldRow[]) => {
  let score = 0;
  for (let index = 0; index < foldRows.length; index += 1) {
    const row = foldRows[index];
    if (row.bph === bph) score += rowScore(row.bins);
  }
  return score;
};

const bestBandIndexes = (standardBph: number, bandNames: string[], foldRows: FoldRow[]) => {
  const scores: { bandIndex: number; score: number }[] = [];

  for (let index = 0; index < foldRows.length; index += 1) {
    const row = foldRows[index];
    if (row.bph !== standardBph) continue;

    const bandIndex = bandNames.indexOf(row.band);
    if (bandIndex < 0) continue;
    scores.push({ bandIndex, score: rowScore(row.bins) });
  }

  return scores
    .sort((left, right) => right.score - left.score)
    .slice(0, TRACKING_BAND_COUNT)
    .map((score) => score.bandIndex);
};

const standardScores = (foldRows: FoldRow[], bandNames: string[]) => {
  const scores: StandardScore[] = [];

  for (let index = 0; index < CANDIDATE_BPH.length; index += 1) {
    const bph = CANDIDATE_BPH[index];
    scores.push({
      standardBph: bph,
      score: standardScore(bph, foldRows),
      bandIndexes: bestBandIndexes(bph, bandNames, foldRows),
    });
  }

  return scores;
};

const averageStandardScores = (history: StandardScore[][]) => {
  const scores = CANDIDATE_BPH.map((bph) => ({
    standardBph: bph,
    score: 0,
    bandIndexes: [] as number[],
  }));

  for (let historyIndex = 0; historyIndex < history.length; historyIndex += 1) {
    for (let scoreIndex = 0; scoreIndex < history[historyIndex].length; scoreIndex += 1) {
      const score = history[historyIndex][scoreIndex];
      const averaged = scores.find((item) => item.standardBph === score.standardBph);
      if (!averaged) continue;
      averaged.score += score.score / history.length;
      if (historyIndex === history.length - 1) averaged.bandIndexes = score.bandIndexes;
    }
  }

  scores.sort((left, right) => right.score - left.score);

  return scores;
};

const chooseStandardBph = (
  state: TrackingState,
  foldRows: FoldRow[],
  bandNames: string[],
): StandardSelection => {
  const standardScoreHistory = state.standardScoreHistory
    .concat([standardScores(foldRows, bandNames)])
    .slice(-STANDARD_SCORE_HISTORY_COUNT);
  const scores = averageStandardScores(standardScoreHistory);
  const best = scores[0] || null;

  if (!state.standardBph || !best || best.standardBph === state.standardBph) {
    return { standard: best, standardScoreHistory };
  }

  const current = scores.find((score) => score.standardBph === state.standardBph);
  const shouldSwitch = !current || best.score > current.score * STANDARD_SWITCH_SCORE_RATIO;

  return {
    standard: shouldSwitch ? best : current,
    standardScoreHistory,
  };
};

const trialScore = (globalState: TrackingGlobalState, bph: number, bandIndexes: number[]) => {
  let score = 0;
  for (let index = 0; index < bandIndexes.length; index += 1) {
    const bandIndex = bandIndexes[index];
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
  bandIndexes: number[],
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
    return { bph, offset, score: trialScore(globalState, bph, bandIndexes) };
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

  const standardSelection = chooseStandardBph(state, foldRows, globalState.bands);
  const standard = standardSelection.standard;
  if (!standard) return state;

  const { standardBph } = standard;
  const bandIndexes = standard.bandIndexes.length
    ? standard.bandIndexes
    : globalState.bands.map((_, index) => index);

  const previousError =
    state.standardBph === standardBph && state.confidenceBph
      ? state.confidenceBph
      : INITIAL_ERROR_BPH;
  const candidates = buildCandidates(state, globalState, standardBph, bandIndexes);
  const bestIndex = bestCandidateIndex(candidates);
  const nextError = candidates[bestIndex].offset === 0 ? previousError / 2 : previousError;

  candidates[bestIndex].best = true;
  candidates[bestIndex].selected = true;

  return {
    standardBph,
    measuredBph: candidates[bestIndex].bph,
    confidenceBph: clamp(nextError, MIN_ERROR_BPH, MAX_ERROR_BPH),
    candidates,
    standardScoreHistory: standardSelection.standardScoreHistory,
  };
};

export const createBphTracker = (): ActualBphTracker => {
  let state = EMPTY_STATE;

  return {
    trackStep(globalState, foldRows) {
      state = trackStep(state, globalState, foldRows);
      return {
        standardBph: state.standardBph,
        measuredBph: state.measuredBph,
        confidenceBph: state.confidenceBph,
        candidates: state.candidates,
      };
    },
  };
};
