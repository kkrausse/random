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
};

export const foldSignal = <TFrame extends FoldFrame>({
  frames,
  featureRate,
  bph,
  cycleBeats,
  binCount,
  valueAt,
  averageByBin = false,
}: FoldSignalOptions<TFrame>) => {
  const bins = new Float32Array(binCount);
  const counts = averageByBin ? new Uint32Array(binCount) : null;
  const intervalSeconds = (3600 / bph) * cycleBeats;

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const seconds = frame.featureFrame / featureRate;
    const phase = (seconds % intervalSeconds) / intervalSeconds;
    const bin = Math.min(binCount - 1, Math.floor(phase * binCount));

    bins[bin] += valueAt(frame);
    if (counts) counts[bin] += 1;
  }

  if (counts) {
    for (let bin = 0; bin < binCount; bin += 1) {
      const count = counts[bin];
      if (count) bins[bin] /= count;
    }
  }

  return bins;
};
