export type FoldFrame = {
  featureFrame: number;
};

export type FoldSignalOptions<TFrame extends FoldFrame> = {
  frames: TFrame[];
  featureRate: number;
  bph: number;
  cycleBeats: number;
  binCount: number;
  valueAt(frame: TFrame): number;
  averageByBin?: boolean;
  applyCycleCoherence?: boolean;
};

const median = (values: number[]) => {
  if (!values.length) return 0;

  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  if (values.length % 2) return values[middle];

  return (values[middle - 1] + values[middle]) / 2;
};

export const foldSignal = <TFrame extends FoldFrame>({
  frames,
  featureRate,
  bph,
  cycleBeats,
  binCount,
  valueAt,
  averageByBin = false,
  applyCycleCoherence = true,
}: FoldSignalOptions<TFrame>) => {
  const bins = new Float32Array(binCount);
  const counts = averageByBin ? new Uint32Array(binCount) : null;
  const cycleBins = applyCycleCoherence ? ([] as Float32Array[]) : null;
  const cycleCounts = applyCycleCoherence ? ([] as Uint32Array[]) : null;
  const cycleIndexes = applyCycleCoherence ? new Map<number, number>() : null;
  const intervalSeconds = (3600 / bph) * cycleBeats;

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const seconds = frame.featureFrame / featureRate;
    const phase = (seconds % intervalSeconds) / intervalSeconds;
    const bin = Math.min(binCount - 1, Math.floor(phase * binCount));
    const value = valueAt(frame);

    bins[bin] += value;
    if (counts) counts[bin] += 1;

    if (cycleBins && cycleCounts && cycleIndexes) {
      const cycle = Math.floor(seconds / intervalSeconds);
      let cycleIndex = cycleIndexes.get(cycle);
      if (cycleIndex === undefined) {
        cycleIndex = cycleBins.length;
        cycleIndexes.set(cycle, cycleIndex);
        cycleBins.push(new Float32Array(binCount));
        cycleCounts.push(new Uint32Array(binCount));
      }

      cycleBins[cycleIndex][bin] += value;
      cycleCounts[cycleIndex][bin] += 1;
    }
  }

  if (counts) {
    for (let bin = 0; bin < binCount; bin += 1) {
      const count = counts[bin];
      if (count) bins[bin] /= count;
    }
  }

  if (cycleBins && cycleCounts) {
    for (let cycle = 0; cycle < cycleBins.length; cycle += 1) {
      const row = cycleBins[cycle];
      const rowCounts = cycleCounts[cycle];
      for (let bin = 0; averageByBin && bin < binCount; bin += 1) {
        const count = rowCounts[bin];
        if (count) row[bin] /= count;
      }
    }

    for (let bin = 0; bin < binCount; bin += 1) {
      const values: number[] = [];
      let max = 0;

      for (let cycle = 0; cycle < cycleBins.length; cycle += 1) {
        if (!cycleCounts[cycle][bin]) continue;

        const value = cycleBins[cycle][bin];
        values.push(value);
        max = Math.max(max, value);
      }

      if (max > 0) {
        bins[bin] *= median(values) / max;
      }
    }
  }

  return bins;
};
