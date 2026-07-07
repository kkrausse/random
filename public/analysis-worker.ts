import {
  CANDIDATE_BPH,
  DEFAULT_ANALYSIS_INTERVAL_MS,
  DEFAULT_BIN_COUNT,
  DEFAULT_FEATURE_RATE,
  DEFAULT_LIFT_ANGLE_DEGREES,
  DEFAULT_PERIOD_SECONDS,
  DEFAULT_TRACKING_FOLD_BIN_COUNT,
} from "./defaults";
import { clamp, normalizeRow } from "./data";
import { foldSignal } from "./util";
import { createBphTracker } from "./tracking-beat-fit";
import type {
  AnalysisWorkerToMainMessage,
  ConfigureAnalysisMessage,
  FeatureMessage,
  FoldRow,
  MainToAnalysisWorkerMessage,
  AmplitudeMeasurement,
  TickTockPeakSample,
  TrackingBandFold,
} from "./data";

type Frame = {
  featureFrame: number;
  seconds?: number;
  bands: Float32Array;
};

type BandScoreTemplate = {
  bandIndex: number;
  bins: Float32Array;
  tickPeakBin: number;
  tockPeakBin: number;
};

type WorkerScope = {
  postMessage(message: AnalysisWorkerToMainMessage, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<MainToAnalysisWorkerMessage>) => void) | null;
};

const workerSelf = self as unknown as WorkerScope;

const state = {
  periodSeconds: DEFAULT_PERIOD_SECONDS,
  featureRate: DEFAULT_FEATURE_RATE,
  binCount: DEFAULT_BIN_COUNT,
  liftAngleDegrees: DEFAULT_LIFT_ANGLE_DEGREES,
  cycleBeats: 2,
  bands: [] as string[],
  frames: [] as Frame[],
  nextStartFrame: 0,
  lastPostTime: 0,
  tracker: createBphTracker(),
};

const PEAK_SCORE_WINDOW_SECONDS = 0.0015;
const TOP_SCORE_BAND_COUNT = 2;
const TEMPLATE_LOG_GAIN = 10;

const configure = (message: ConfigureAnalysisMessage) => {
  state.periodSeconds = clamp(Number(message.periodSeconds) || DEFAULT_PERIOD_SECONDS, 2, 30);
  state.binCount = Number(message.binCount) || DEFAULT_BIN_COUNT;
  state.liftAngleDegrees = clamp(
    Number(message.liftAngleDegrees) || DEFAULT_LIFT_ANGLE_DEGREES,
    20,
    90,
  );
  trimFrames();
};

const ensureBandBuffers = (features: FeatureMessage["features"]) => {
  const names = features.map((feature) => feature.name);
  const changed =
    names.length !== state.bands.length ||
    names.some((name, index) => name !== state.bands[index]);

  if (changed) {
    state.bands = names;
    state.frames = [];
    state.nextStartFrame = 0;
    state.tracker = createBphTracker();
  }
};

const trimFrames = () => {
  const framesToKeep = Math.ceil(state.periodSeconds * state.featureRate);
  if (state.frames.length > framesToKeep) {
    state.frames.splice(0, state.frames.length - framesToKeep);
  }
};

const receiveFeatures = (message: FeatureMessage) => {
  state.featureRate = Number(message.featureRate) || state.featureRate;
  ensureBandBuffers(message.features);

  const frameCount = message.features[0]?.data?.length || 0;
  const sampleRate = Number(message.sampleRate) || 0;
  for (let offset = 0; offset < frameCount; offset += 1) {
    const featureFrame = message.startFrame + offset;
    const bands = new Float32Array(state.bands.length);
    for (let bandIndex = 0; bandIndex < state.bands.length; bandIndex += 1) {
      bands[bandIndex] = message.features[bandIndex].data[offset];
    }
    state.frames.push({
      featureFrame,
      seconds:
        sampleRate > 0
          ? Math.ceil(((featureFrame + 1) * sampleRate) / state.featureRate) / sampleRate
          : undefined,
      bands,
    });
  }

  trimFrames();
  maybePostAnalysis();
};

const foldStandardCandidate = (bph: number, bandIndex: number) => {
  return normalizeRow(
    foldSignal({
      frames: state.frames,
      featureRate: state.featureRate,
      bph,
      cycleBeats: state.cycleBeats,
      binCount: state.binCount,
      valueAt: (frame) => frame.bands[bandIndex],
    }),
  );
};

const buildStandardFoldRows = () => {
  const rows: FoldRow[] = [];

  for (let bphIndex = 0; bphIndex < CANDIDATE_BPH.length; bphIndex += 1) {
    const bph = CANDIDATE_BPH[bphIndex];
    for (let bandIndex = 0; bandIndex < state.bands.length; bandIndex += 1) {
      const bins = foldStandardCandidate(bph, bandIndex);
      const row = {
        bph,
        band: state.bands[bandIndex],
        bins,
      };

      rows.push(row);
    }
  }

  return rows;
};

const buildTrackingFold = (bph: number | null, score?: number) => {
  if (!bph) return null;

  const binCount = DEFAULT_TRACKING_FOLD_BIN_COUNT;
  const bins = foldSignal({
    frames: state.frames,
    featureRate: state.featureRate,
    bph,
    cycleBeats: state.cycleBeats,
    binCount,
    averageByBin: true,
    valueAt: (frame) => {
      let total = 0;
      for (let bandIndex = 0; bandIndex < state.bands.length; bandIndex += 1) {
        total += frame.bands[bandIndex];
      }
      return total;
    },
  });

  return {
    bph,
    binCount,
    cycleBeats: state.cycleBeats,
    bins,
    score,
  };
};

const buildTrackingBandFolds = (bph: number | null) => {
  if (!bph) return [];

  const binCount = DEFAULT_TRACKING_FOLD_BIN_COUNT;
  const rows: TrackingBandFold[] = [];

  for (let bandIndex = 0; bandIndex < state.bands.length; bandIndex += 1) {
    const bins = foldSignal({
      frames: state.frames,
      featureRate: state.featureRate,
      bph,
      cycleBeats: state.cycleBeats,
      binCount,
      averageByBin: true,
      valueAt: (frame) => frame.bands[bandIndex],
    });

    rows.push({
      bph,
      binCount,
      cycleBeats: state.cycleBeats,
      band: state.bands[bandIndex],
      bins,
    });
  }

  return rows;
};

const buildTrackingCandidateFolds = (tracking: ReturnType<typeof state.tracker.trackStep>) => {
  return tracking.candidates
    .map((candidate) => buildTrackingFold(candidate.bph, candidate.score))
    .filter((fold) => fold !== null);
};

const frameSeconds = (frame: Frame) => frame.seconds ?? frame.featureFrame / state.featureRate;

const frameEnergy = (frame: Frame) => {
  let total = 0;
  for (let bandIndex = 0; bandIndex < state.bands.length; bandIndex += 1) {
    total += frame.bands[bandIndex];
  }
  return total;
};

const wrapIndex = (index: number, count: number) => ((index % count) + count) % count;

const average = (values: Float32Array) => {
  if (!values.length) return 0;

  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    total += values[index];
  }
  return total / values.length;
};

const templateValueAt = (template: Float32Array, position: number) => {
  const lower = Math.floor(position);
  const upperWeight = position - lower;
  const lowerWeight = 1 - upperWeight;
  return (
    template[wrapIndex(lower, template.length)] * lowerWeight +
    template[wrapIndex(lower + 1, template.length)] * upperWeight
  );
};

const buildScoreTemplate = (bins: Float32Array) => {
  const rowMean = average(bins);
  const template = new Float32Array(bins.length);

  for (let bin = 0; bin < bins.length; bin += 1) {
    template[bin] = Math.log1p(Math.max(0, bins[bin] - rowMean) * TEMPLATE_LOG_GAIN);
  }

  return template;
};

const buildBandScoreTemplates = (rows: TrackingBandFold[], beatBinCount: number) => {
  return rows.map((row, bandIndex) => {
    const bins = buildScoreTemplate(row.bins);
    return {
      bandIndex,
      bins,
      tickPeakBin: findPeakBin(bins, 0, beatBinCount),
      tockPeakBin: findPeakBin(bins, beatBinCount, beatBinCount),
    };
  });
};

const findPeakBin = (bins: Float32Array, start: number, count: number) => {
  let peakBin = start;
  let peakValue = bins[start] ?? 0;

  for (let offset = 1; offset < count; offset += 1) {
    const bin = start + offset;
    if (bins[bin] > peakValue) {
      peakBin = bin;
      peakValue = bins[bin];
    }
  }

  return peakBin;
};

const smoothBeatValue = (
  bins: Float32Array,
  beatStartBin: number,
  beatBinCount: number,
  beatOffset: number,
  radius: number,
) => {
  let total = 0;
  let count = 0;

  for (let offset = -radius; offset <= radius; offset += 1) {
    const bin = beatStartBin + wrapIndex(beatOffset + offset, beatBinCount);
    total += bins[bin] ?? 0;
    count += 1;
  }

  return count ? total / count : 0;
};

const findFirstLumpOffset = (
  bins: Float32Array,
  beatStartBin: number,
  peakBin: number,
  beatBinCount: number,
  windowBins: number,
  smoothRadius: number,
) => {
  const peakOffset = peakBin - beatStartBin;
  const peakValue = smoothBeatValue(
    bins,
    beatStartBin,
    beatBinCount,
    peakOffset,
    smoothRadius,
  );
  const minValue = peakValue * 0.08;
  let firstAboveOffset: number | null = null;
  let bestOffset = 0;
  let bestValue = 0;

  for (let offset = -windowBins + 1; offset < -1; offset += 1) {
    const beatOffset = wrapIndex(peakOffset + offset, beatBinCount);
    const prev = smoothBeatValue(
      bins,
      beatStartBin,
      beatBinCount,
      beatOffset - 1,
      smoothRadius,
    );
    const value = smoothBeatValue(
      bins,
      beatStartBin,
      beatBinCount,
      beatOffset,
      smoothRadius,
    );
    const next = smoothBeatValue(
      bins,
      beatStartBin,
      beatBinCount,
      beatOffset + 1,
      smoothRadius,
    );

    if (firstAboveOffset === null && value >= minValue) {
      firstAboveOffset = offset;
    }

    if (value >= minValue && value >= prev && value > next) {
      return offset;
    }

    if (value > bestValue) {
      bestOffset = offset;
      bestValue = value;
    }
  }

  if (firstAboveOffset !== null) return firstAboveOffset;

  return bestValue >= minValue ? bestOffset : null;
};

const amplitudeFromLiftTime = (
  liftAngleDegrees: number,
  liftSeconds: number,
  cycleSeconds: number,
) => {
  if (liftSeconds <= 0 || cycleSeconds <= 0) return null;

  const denominator = 2 * Math.sin((Math.PI * liftSeconds) / cycleSeconds);
  if (denominator <= 0) return null;

  return liftAngleDegrees / denominator;
};

const buildAmplitudeMeasurement = (
  name: "tick" | "tock",
  fold: NonNullable<ReturnType<typeof buildTrackingFold>>,
  beatStartBin: number,
  peakBin: number,
  beatBinCount: number,
  windowBins: number,
  binSeconds: number,
  cycleSeconds: number,
) => {
  const smoothRadius = Math.max(1, Math.round(0.00025 / binSeconds));
  const firstOffset = findFirstLumpOffset(
    fold.bins,
    beatStartBin,
    peakBin,
    beatBinCount,
    windowBins,
    smoothRadius,
  );

  if (firstOffset === null) return null;

  const liftSeconds = Math.abs(firstOffset * binSeconds);
  const amplitudeDegrees = amplitudeFromLiftTime(
    state.liftAngleDegrees,
    liftSeconds,
    cycleSeconds,
  );

  return {
    name,
    firstOffsetSeconds: Number((firstOffset * binSeconds).toFixed(5)),
    liftSeconds: Number(liftSeconds.toFixed(5)),
    amplitudeDegrees:
      amplitudeDegrees === null ? null : Number(amplitudeDegrees.toFixed(1)),
  };
};

const buildBalanceAmplitude = (fold: NonNullable<ReturnType<typeof buildTrackingFold>>) => {
  if (fold.cycleBeats < 2) return null;

  const cycleSeconds = (3600 / fold.bph) * fold.cycleBeats;
  const beatBinCount = Math.floor(fold.binCount / fold.cycleBeats);
  const binSeconds = cycleSeconds / fold.binCount;
  const windowBins = Math.max(2, Math.round(beatBinCount * 0.12));
  const tickPeakBin = findPeakBin(fold.bins, 0, beatBinCount);
  const tockStartBin = beatBinCount;
  const tockPeakBin = findPeakBin(fold.bins, tockStartBin, beatBinCount);
  const measurements = [
    buildAmplitudeMeasurement(
      "tick",
      fold,
      0,
      tickPeakBin,
      beatBinCount,
      windowBins,
      binSeconds,
      cycleSeconds,
    ),
    buildAmplitudeMeasurement(
      "tock",
      fold,
      tockStartBin,
      tockPeakBin,
      beatBinCount,
      windowBins,
      binSeconds,
      cycleSeconds,
    ),
  ].filter((measurement) => measurement !== null) as AmplitudeMeasurement[];
  const valid = measurements
    .map((measurement) => measurement.amplitudeDegrees)
    .filter((value) => value !== null) as number[];
  const averageDegrees = valid.length
    ? valid.reduce((total, value) => total + value, 0) / valid.length
    : null;
  const averageLiftSeconds = measurements.length
    ? measurements.reduce((total, measurement) => total + measurement.liftSeconds, 0) /
      measurements.length
    : null;

  return {
    liftAngleDegrees: state.liftAngleDegrees,
    averageDegrees: averageDegrees === null ? null : Number(averageDegrees.toFixed(1)),
    averageLiftSeconds:
      averageLiftSeconds === null ? null : Number(averageLiftSeconds.toFixed(5)),
    measurements,
  };
};

const buildPeakSample = (
  name: string,
  fold: NonNullable<ReturnType<typeof buildTrackingFold>>,
  templates: BandScoreTemplate[],
  peakTime: number,
  windowSeconds: number,
  sign: 1 | -1,
  estimateTime?: number,
) => {
  const rawScores: number[] = [];
  const cycleSeconds = (3600 / fold.bph) * fold.cycleBeats;
  const beatBinCount = Math.floor(fold.binCount / fold.cycleBeats);
  const peakBin =
    sign === 1
      ? findPeakBin(fold.bins, 0, beatBinCount)
      : findPeakBin(fold.bins, beatBinCount, beatBinCount);
  const peakScale = Math.max(0.0001, fold.bins[peakBin] ?? 0);
  let maxScore = 0;

  for (let index = 0; index < state.frames.length; index += 1) {
    const frame = state.frames[index];
    const seconds = frameSeconds(frame);
    if (seconds < peakTime - windowSeconds) continue;
    if (seconds > peakTime + windowSeconds) break;
    const scores: number[] = [];

    for (let templateIndex = 0; templateIndex < templates.length; templateIndex += 1) {
      const template = templates[templateIndex];
      const bandPeakBin = sign === 1 ? template.tickPeakBin : template.tockPeakBin;
      let score = 0;

      for (let scan = index; scan >= 0; scan -= 1) {
        const scanFrame = state.frames[scan];
        const offsetSeconds = frameSeconds(scanFrame) - seconds;
        if (offsetSeconds < -PEAK_SCORE_WINDOW_SECONDS) break;

        const offsetBins = (offsetSeconds / cycleSeconds) * fold.binCount;
        score +=
          (scanFrame.bands[template.bandIndex] || 0) *
          templateValueAt(template.bins, bandPeakBin + offsetBins);
      }

      for (let scan = index + 1; scan < state.frames.length; scan += 1) {
        const scanFrame = state.frames[scan];
        const offsetSeconds = frameSeconds(scanFrame) - seconds;
        if (offsetSeconds > PEAK_SCORE_WINDOW_SECONDS) break;

        const offsetBins = (offsetSeconds / cycleSeconds) * fold.binCount;
        score +=
          (scanFrame.bands[template.bandIndex] || 0) *
          templateValueAt(template.bins, bandPeakBin + offsetBins);
      }

      if (score > 0) scores.push(score);
    }

    scores.sort((left, right) => right - left);
    let score = 0;
    for (
      let scoreIndex = 0;
      scoreIndex < scores.length && scoreIndex < TOP_SCORE_BAND_COUNT;
      scoreIndex += 1
    ) {
      score += scores[scoreIndex];
    }

    rawScores.push(Number((seconds - peakTime).toFixed(5)), score);
    maxScore = Math.max(maxScore, score);
  }

  if (!rawScores.length || maxScore <= 0) return null;

  const points: number[] = [];
  for (let index = 0; index < rawScores.length; index += 2) {
    points.push(
      rawScores[index],
      Number((((rawScores[index + 1] / maxScore) * peakScale) * sign).toFixed(4)),
    );
  }

  return {
    name,
    estimateOffsetSeconds:
      estimateTime === undefined ? undefined : Number((estimateTime - peakTime).toFixed(5)),
    points,
  };
};

const estimatedPeakTime = (
  fold: NonNullable<ReturnType<typeof buildTrackingFold>>,
  peakBin: number,
  approximateTime: number,
) => {
  const cycleSeconds = (3600 / fold.bph) * fold.cycleBeats;
  const phaseSeconds = (peakBin / fold.binCount) * cycleSeconds;
  const cycle = Math.round((approximateTime - phaseSeconds) / cycleSeconds);
  return cycle * cycleSeconds + phaseSeconds;
};

const buildTickTockPeakSamples = (
  fold: NonNullable<ReturnType<typeof buildTrackingFold>>,
  bandFolds: TrackingBandFold[],
  estimateFold: ReturnType<typeof buildTrackingFold>,
) => {
  if (fold.cycleBeats < 2 || state.frames.length === 0) return [];

  const cycleSeconds = (3600 / fold.bph) * fold.cycleBeats;
  const beatBinCount = Math.floor(fold.binCount / fold.cycleBeats);
  const binSeconds = cycleSeconds / fold.binCount;
  const windowSeconds = Math.max(0.002, beatBinCount * 0.12 * binSeconds);
  const tickPeakBin = findPeakBin(fold.bins, 0, beatBinCount);
  const tockPeakBin = findPeakBin(fold.bins, beatBinCount, beatBinCount);
  const templates = buildBandScoreTemplates(bandFolds, beatBinCount);
  if (!templates.length) return [];
  const estimateBeatBinCount = estimateFold
    ? Math.floor(estimateFold.binCount / estimateFold.cycleBeats)
    : 0;
  const estimateTickPeakBin = estimateFold
    ? findPeakBin(estimateFold.bins, 0, estimateBeatBinCount)
    : 0;
  const estimateTockPeakBin = estimateFold
    ? findPeakBin(estimateFold.bins, estimateBeatBinCount, estimateBeatBinCount)
    : 0;
  const firstSeconds = frameSeconds(state.frames[0]);
  const lastSeconds = frameSeconds(state.frames[state.frames.length - 1]);
  const firstCycle = Math.floor(firstSeconds / cycleSeconds) - 1;
  const lastCycle = Math.ceil(lastSeconds / cycleSeconds) + 1;
  const samples: TickTockPeakSample[] = [];
  const peakTimes: { name: string; time: number; sign: 1 | -1; estimateTime?: number }[] = [];

  for (let cycle = firstCycle; cycle <= lastCycle; cycle += 1) {
    const tickTime = cycle * cycleSeconds + (tickPeakBin / fold.binCount) * cycleSeconds;
    const tockTime = cycle * cycleSeconds + (tockPeakBin / fold.binCount) * cycleSeconds;
    peakTimes.push({
      name: "tick sample",
      time: tickTime,
      sign: 1,
      estimateTime: estimateFold
        ? estimatedPeakTime(estimateFold, estimateTickPeakBin, tickTime)
        : undefined,
    });
    peakTimes.push({
      name: "tock sample",
      time: tockTime,
      sign: -1,
      estimateTime: estimateFold
        ? estimatedPeakTime(estimateFold, estimateTockPeakBin, tockTime)
        : undefined,
    });
  }

  const visiblePeakTimes = peakTimes
    .filter(
      (peak) =>
        peak.time >= firstSeconds + windowSeconds &&
        peak.time <= lastSeconds - windowSeconds,
    )
    .slice(-16);

  for (let index = 0; index < visiblePeakTimes.length; index += 1) {
    const peak = visiblePeakTimes[index];
    const sample = buildPeakSample(
      `${peak.name} ${index + 1}`,
      fold,
      templates,
      peak.time,
      windowSeconds,
      peak.sign,
      peak.estimateTime,
    );
    if (sample) samples.push(sample);
  }

  return samples;
};

const maybePostAnalysis = () => {
  const now = Date.now();
  if (
    now - state.lastPostTime < DEFAULT_ANALYSIS_INTERVAL_MS ||
    state.frames.length < state.featureRate * 0.25
  ) {
    return;
  }

  const startedAt = performance.now();
  state.lastPostTime = now;
  const rows = buildStandardFoldRows();
  const tracking = state.tracker.trackStep(
    {
      featureRate: state.featureRate,
      cycleBeats: state.cycleBeats,
      bands: state.bands,
      frames: state.frames,
    },
    rows,
  );
  const trackingFold = buildTrackingFold(tracking.standardBph);
  const trackingBandFolds = buildTrackingBandFolds(tracking.standardBph);
  const trackingCandidateFolds = buildTrackingCandidateFolds(tracking);
  const estimateFold =
    tracking.measuredBph === null ? null : buildTrackingFold(tracking.measuredBph);
  const tickTockPeakSamples = trackingFold
    ? buildTickTockPeakSamples(trackingFold, trackingBandFolds, estimateFold)
    : [];
  const balanceAmplitude = trackingFold ? buildBalanceAmplitude(trackingFold) : null;
  const transfers = rows.map((row) => row.bins.buffer);
  if (trackingFold) {
    transfers.push(trackingFold.bins.buffer);
  }
  for (let index = 0; index < trackingBandFolds.length; index += 1) {
    transfers.push(trackingBandFolds[index].bins.buffer);
  }
  for (let index = 0; index < trackingCandidateFolds.length; index += 1) {
    transfers.push(trackingCandidateFolds[index].bins.buffer);
  }
  const analysisMs = performance.now() - startedAt;

  workerSelf.postMessage(
    {
      type: "analysis",
      periodSeconds: state.periodSeconds,
      featureRate: state.featureRate,
      analysisMs: Number(analysisMs.toFixed(1)),
      framesBuffered: state.frames.length,
      standardFolds: {
        binCount: state.binCount,
        cycleBeats: state.cycleBeats,
        rows,
      },
      tracking: {
        standardBph: tracking.standardBph,
        measuredBph: tracking.measuredBph,
        confidenceBph: tracking.confidenceBph,
        candidates: tracking.candidates,
      },
      trackingFold,
      trackingBandFolds,
      trackingCandidateFolds,
      tickTockPeakSamples,
      balanceAmplitude,
    },
    transfers,
  );
};

workerSelf.onmessage = (event) => {
  const message = event.data;
  if (message.type === "configure") {
    configure(message);
  }
  if (message.type === "features") {
    receiveFeatures(message);
  }
};
