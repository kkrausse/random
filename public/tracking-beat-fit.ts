import { CANDIDATE_BPH, DEFAULT_TRACKING_FOLD_BIN_COUNT } from "./defaults";
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

type RowScore = {
  bandIndex: number;
  score: number;
};

type BeatPick = {
  beatIndex: number;
  time: number;
  score: number;
};

type FoldTemplate = {
  bins: Float32Array;
  peakBins: number[];
  cycleSeconds: number;
  score: number;
};

type BphEstimate = {
  bph: number;
  score: number;
};

type TrackingState = Tracking & {
  score: number;
};

const MIN_TRACKING_SECONDS = 2;
const MAX_ERROR_BPH = 300;
const TOP_BAND_COUNT = 2;
const GATE_SECONDS = 0.001;
const PEAK_WINDOW_SECONDS = 0.0015;
const PACKET_AVERAGE_SECONDS = 0.0008;
const TEMPLATE_LOG_GAIN = 10;
const HISTORY_BEATS = [8, 10, 12, 14, 16, 18, 20, 24, 30, 36, 40];

const EMPTY_TRACKING_STATE: TrackingState = {
  standardBph: null,
  measuredBph: null,
  confidenceBph: null,
  candidates: [],
  score: 0,
};

const frameSeconds = (frame: TrackingFrame, featureRate: number) => {
  return frame.seconds ?? frame.featureFrame / featureRate;
};

const wrapIndex = (index: number, length: number) => {
  return ((index % length) + length) % length;
};

const average = (values: ArrayLike<number>) => {
  if (!values.length) return 0;

  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    total += values[index];
  }
  return total / values.length;
};

const median = (values: number[]) => {
  if (!values.length) return 0;

  values.sort((left, right) => left - right);
  const middle = Math.floor(values.length / 2);
  if (values.length % 2) return values[middle];
  return (values[middle - 1] + values[middle]) / 2;
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

const rowPacketScore = (bins: Float32Array, bph: number, cycleBeats: number) => {
  if (!bins.length) return 0;

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

  if (signalTotal <= 0) return 0;

  const peakSums = circularWindowSums(signal, peakRadius);
  let bestPair = 0;

  for (let index = 0; index < peakSums.length; index += 1) {
    const opposite = peakSums[(index + halfCycle) % peakSums.length];
    bestPair = Math.max(bestPair, Math.min(peakSums[index], opposite));
  }

  return (bestPair * bestPair) / signalTotal;
};

const scoreStandard = (bph: number, foldRows: FoldRow[], cycleBeats: number) => {
  let score = 0;

  for (let index = 0; index < foldRows.length; index += 1) {
    const row = foldRows[index];
    if (row.bph !== bph) continue;
    score += rowPacketScore(row.bins, bph, cycleBeats);
  }

  return score;
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

const chooseBandIndexes = (
  globalState: TrackingGlobalState,
  foldRows: FoldRow[],
  standardBph: number,
) => {
  const scores: RowScore[] = [];

  for (let rowIndex = 0; rowIndex < foldRows.length; rowIndex += 1) {
    const row = foldRows[rowIndex];
    if (row.bph !== standardBph) continue;

    const bandIndex = globalState.bands.indexOf(row.band);
    if (bandIndex < 0) continue;

    scores.push({
      bandIndex,
      score: rowPacketScore(row.bins, standardBph, globalState.cycleBeats),
    });
  }

  scores.sort((left, right) => right.score - left.score);

  const selected: number[] = [];
  for (let index = 0; index < scores.length && selected.length < TOP_BAND_COUNT; index += 1) {
    if (scores[index].score <= 0) continue;
    if (selected.includes(scores[index].bandIndex)) continue;
    selected.push(scores[index].bandIndex);
  }

  if (selected.length) return selected;
  return globalState.bands.map((_, index) => index);
};

const frameEnergy = (frame: TrackingFrame, bandIndexes: number[]) => {
  let total = 0;
  for (let index = 0; index < bandIndexes.length; index += 1) {
    total += frame.bands[bandIndexes[index]] || 0;
  }
  return total;
};

const templateValueAt = (template: FoldTemplate, position: number) => {
  const lower = Math.floor(position);
  const upperWeight = position - lower;
  const lowerWeight = 1 - upperWeight;
  return (
    template.bins[wrapIndex(lower, template.bins.length)] * lowerWeight +
    template.bins[wrapIndex(lower + 1, template.bins.length)] * upperWeight
  );
};

const findFoldTemplate = (
  globalState: TrackingGlobalState,
  standardBph: number,
  bandIndexes: number[],
): FoldTemplate => {
  const bins = foldSignal({
    frames: globalState.frames,
    featureRate: globalState.featureRate,
    bph: standardBph,
    cycleBeats: globalState.cycleBeats,
    binCount: DEFAULT_TRACKING_FOLD_BIN_COUNT,
    averageByBin: true,
    valueAt: (frame) => frameEnergy(frame, bandIndexes),
  });
  const packetRadius = packetAverageRadius(
    bins.length,
    standardBph,
    globalState.cycleBeats,
  );
  const smoothed = smoothedBins(bins, packetRadius);
  const rowMean = average(smoothed);
  const template = new Float32Array(smoothed.length);
  const segmentCount = Math.max(1, globalState.cycleBeats);
  const segmentBins = Math.floor(smoothed.length / segmentCount);
  const peakBins: number[] = [];
  let totalScore = 0;

  for (let bin = 0; bin < smoothed.length; bin += 1) {
    template[bin] = Math.log1p(Math.max(0, smoothed[bin] - rowMean) * TEMPLATE_LOG_GAIN);
  }

  for (let segment = 0; segment < segmentCount; segment += 1) {
    const startBin = segment * segmentBins;
    const endBin =
      segment === segmentCount - 1 ? smoothed.length : (segment + 1) * segmentBins;
    let bestBin = startBin;
    let bestScore = -Infinity;

    for (let bin = startBin; bin < endBin; bin += 1) {
      const score = template[bin];
      if (score > bestScore) {
        bestBin = bin;
        bestScore = score;
      }
    }

    peakBins.push(bestBin);
    totalScore += Math.max(0, bestScore);
  }

  const cycleSeconds = (3600 / standardBph) * globalState.cycleBeats;
  return {
    bins: template,
    peakBins,
    cycleSeconds,
    score: totalScore,
  };
};

const dotTemplateAt = (
  globalState: TrackingGlobalState,
  bandIndexes: number[],
  template: FoldTemplate,
  beatIndex: number,
  centerTime: number,
) => {
  const beatSegment = wrapIndex(beatIndex, template.peakBins.length);
  const peakBin = template.peakBins[beatSegment];
  let score = 0;

  for (let index = 0; index < globalState.frames.length; index += 1) {
    const frame = globalState.frames[index];
    const seconds = frameSeconds(frame, globalState.featureRate);
    if (seconds < centerTime - PEAK_WINDOW_SECONDS) continue;
    if (seconds > centerTime + PEAK_WINDOW_SECONDS) break;

    const offsetSeconds = seconds - centerTime;
    const offsetBins = (offsetSeconds / template.cycleSeconds) * template.bins.length;
    score += frameEnergy(frame, bandIndexes) * templateValueAt(template, peakBin + offsetBins);
  }

  return score;
};

const pickBeat = (
  globalState: TrackingGlobalState,
  bandIndexes: number[],
  template: FoldTemplate,
  beatIndex: number,
  predictedTime: number,
) => {
  let bestTime = 0;
  let bestScore = 0;

  for (let index = 0; index < globalState.frames.length; index += 1) {
    const frame = globalState.frames[index];
    const seconds = frameSeconds(frame, globalState.featureRate);
    if (seconds < predictedTime - GATE_SECONDS) continue;
    if (seconds > predictedTime + GATE_SECONDS) break;

    const score = dotTemplateAt(globalState, bandIndexes, template, beatIndex, seconds);
    if (score > bestScore) {
      bestScore = score;
      bestTime = seconds;
    }
  }

  if (bestScore <= 0) return null;

  return {
    beatIndex,
    time: bestTime,
    score: bestScore,
  };
};

const pickBeats = (
  globalState: TrackingGlobalState,
  standardBph: number,
  template: FoldTemplate,
  bandIndexes: number[],
) => {
  const firstFrame = globalState.frames[0];
  const lastFrame = globalState.frames[globalState.frames.length - 1];
  if (!firstFrame || !lastFrame) return [];

  const beatSeconds = 3600 / standardBph;
  const firstSeconds = frameSeconds(firstFrame, globalState.featureRate);
  const lastSeconds = frameSeconds(lastFrame, globalState.featureRate);
  const firstBeat = Math.floor(firstSeconds / beatSeconds) - globalState.cycleBeats;
  const lastBeat = Math.ceil(lastSeconds / beatSeconds) + globalState.cycleBeats;
  const picks: BeatPick[] = [];

  for (let beatIndex = firstBeat; beatIndex <= lastBeat; beatIndex += 1) {
    const beatSegment = wrapIndex(beatIndex, template.peakBins.length);
    const cycleIndex = Math.floor(beatIndex / globalState.cycleBeats);
    const predictedTime =
      cycleIndex * template.cycleSeconds +
      (template.peakBins[beatSegment] / template.bins.length) * template.cycleSeconds;
    if (predictedTime < firstSeconds - GATE_SECONDS) continue;
    if (predictedTime > lastSeconds + GATE_SECONDS) continue;

    const pick = pickBeat(globalState, bandIndexes, template, beatIndex, predictedTime);
    if (pick) picks.push(pick);
  }

  return picks;
};

const estimateBph = (picks: BeatPick[], standardBph: number) => {
  const byBeat = new Map<number, BeatPick>();
  const estimates: BphEstimate[] = [];

  for (let index = 0; index < picks.length; index += 1) {
    byBeat.set(picks[index].beatIndex, picks[index]);
  }

  for (let index = 0; index < picks.length; index += 1) {
    const pick = picks[index];
    for (let historyIndex = 0; historyIndex < HISTORY_BEATS.length; historyIndex += 1) {
      const beatDelta = HISTORY_BEATS[historyIndex];
      const previous = byBeat.get(pick.beatIndex - beatDelta);
      if (!previous) continue;

      const seconds = pick.time - previous.time;
      if (seconds <= 0) continue;

      const bph = (3600 * beatDelta) / seconds;
      if (Math.abs(bph - standardBph) > MAX_ERROR_BPH) continue;

      estimates.push({
        bph,
        score: Math.min(pick.score, previous.score) * beatDelta,
      });
    }
  }

  if (!estimates.length) {
    return {
      measuredBph: null,
      confidenceBph: null,
      candidates: [] as TrackingCandidate[],
    };
  }

  const values = estimates.map((estimate) => estimate.bph);
  const roughBph = median(values);
  const roughDeviations = values.map((value) => Math.abs(value - roughBph));
  const roughSpread = Math.max(2, median(roughDeviations) * 1.4826);
  const filtered = estimates.filter(
    (estimate) => Math.abs(estimate.bph - roughBph) <= roughSpread * 2.5,
  );
  const filteredValues = (filtered.length ? filtered : estimates).map(
    (estimate) => estimate.bph,
  );
  const measuredBph = median(filteredValues);
  const deviations = filteredValues.map((value) => Math.abs(value - measuredBph));
  const confidenceBph = Math.max(0.1, median(deviations) * 1.4826);
  const candidates = estimates
    .slice()
    .sort((left, right) => right.score - left.score)
    .slice(0, 9)
    .map((estimate) => ({
      bph: estimate.bph,
      score: estimate.score,
    }));

  return {
    measuredBph,
    confidenceBph,
    candidates,
  };
};

const estimateWithTemplate = (
  globalState: TrackingGlobalState,
  bandIndexes: number[],
  templateBph: number,
  standardBph: number,
) => {
  const template = findFoldTemplate(globalState, templateBph, bandIndexes);
  const picks = pickBeats(globalState, templateBph, template, bandIndexes);
  const estimate = estimateBph(picks, standardBph);

  return {
    template,
    estimate,
  };
};

const trackStep = (
  previous: TrackingState,
  globalState: TrackingGlobalState,
  foldRows: FoldRow[],
): TrackingState => {
  const availableSeconds = globalState.frames.length / globalState.featureRate;
  if (
    availableSeconds < MIN_TRACKING_SECONDS ||
    globalState.bands.length === 0 ||
    foldRows.length === 0
  ) {
    return previous;
  }

  const standardBph = chooseStandardBph(foldRows, globalState.cycleBeats);
  if (!standardBph) return previous;

  const bandIndexes = chooseBandIndexes(globalState, foldRows, standardBph);
  let result = estimateWithTemplate(globalState, bandIndexes, standardBph, standardBph);

  if (
    result.estimate.measuredBph !== null &&
    Math.abs(result.estimate.measuredBph - standardBph) <= MAX_ERROR_BPH
  ) {
    result = estimateWithTemplate(
      globalState,
      bandIndexes,
      result.estimate.measuredBph,
      standardBph,
    );
  }

  return {
    standardBph,
    measuredBph: result.estimate.measuredBph ?? previous.measuredBph,
    confidenceBph: result.estimate.confidenceBph,
    candidates: result.estimate.candidates,
    score: result.template.score,
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
