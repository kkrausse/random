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
  bandIndex: number;
  bins: Float32Array;
  peakBins: number[];
  cycleSeconds: number;
  score: number;
};

type TemplateSet = {
  templates: FoldTemplate[];
  guide: FoldTemplate;
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
  bandIndex: number,
): FoldTemplate => {
  const bins = foldSignal({
    frames: globalState.frames,
    featureRate: globalState.featureRate,
    bph: standardBph,
    cycleBeats: globalState.cycleBeats,
    binCount: DEFAULT_TRACKING_FOLD_BIN_COUNT,
    averageByBin: true,
    valueAt: (frame) => frame.bands[bandIndex] || 0,
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
    bandIndex,
    bins: template,
    peakBins,
    cycleSeconds,
    score: totalScore,
  };
};

const findTemplateSet = (
  globalState: TrackingGlobalState,
  templateBph: number,
): TemplateSet | null => {
  const templates: FoldTemplate[] = [];
  let guide: FoldTemplate | null = null;

  for (let bandIndex = 0; bandIndex < globalState.bands.length; bandIndex += 1) {
    const template = findFoldTemplate(globalState, templateBph, bandIndex);
    templates.push(template);
    if (!guide || template.score > guide.score) guide = template;
  }

  if (!guide) return null;

  const scores = templates
    .map((template) => template.score)
    .sort((left, right) => right - left);
  let score = 0;
  for (let index = 0; index < scores.length && index < TOP_BAND_COUNT; index += 1) {
    score += scores[index];
  }

  return {
    templates,
    guide,
    score,
  };
};

const dotTemplateAt = (
  globalState: TrackingGlobalState,
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
    score +=
      (frame.bands[template.bandIndex] || 0) *
      templateValueAt(template, peakBin + offsetBins);
  }

  return score;
};

const dotTemplateSetAt = (
  globalState: TrackingGlobalState,
  templateSet: TemplateSet,
  beatIndex: number,
  centerTime: number,
) => {
  const scores: RowScore[] = [];

  for (let index = 0; index < templateSet.templates.length; index += 1) {
    const template = templateSet.templates[index];
    const score = dotTemplateAt(globalState, template, beatIndex, centerTime);
    if (score <= 0) continue;

    scores.push({
      bandIndex: template.bandIndex,
      score,
    });
  }

  scores.sort((left, right) => right.score - left.score);

  let total = 0;
  for (let index = 0; index < scores.length && index < TOP_BAND_COUNT; index += 1) {
    total += scores[index].score;
  }

  return total;
};

const pickBeat = (
  globalState: TrackingGlobalState,
  templateSet: TemplateSet,
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

    const score = dotTemplateSetAt(globalState, templateSet, beatIndex, seconds);
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
  templateSet: TemplateSet,
) => {
  const template = templateSet.guide;
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

    const pick = pickBeat(globalState, templateSet, beatIndex, predictedTime);
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
  templateBph: number,
  standardBph: number,
) => {
  const templateSet = findTemplateSet(globalState, templateBph);
  if (!templateSet) {
    return {
      template: null,
      estimate: {
        measuredBph: null,
        confidenceBph: null,
        candidates: [] as TrackingCandidate[],
      },
    };
  }

  const picks = pickBeats(globalState, templateBph, templateSet);
  const estimate = estimateBph(picks, standardBph);

  return {
    template: templateSet,
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

  let result = estimateWithTemplate(globalState, standardBph, standardBph);

  if (
    result.estimate.measuredBph !== null &&
    Math.abs(result.estimate.measuredBph - standardBph) <= MAX_ERROR_BPH
  ) {
    result = estimateWithTemplate(
      globalState,
      result.estimate.measuredBph,
      standardBph,
    );
  }

  return {
    standardBph,
    measuredBph: result.estimate.measuredBph ?? previous.measuredBph,
    confidenceBph: result.estimate.confidenceBph,
    candidates: result.estimate.candidates,
    score: result.template?.score ?? 0,
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
