export const CANDIDATE_BPH = [14400, 18000, 19800, 21600, 25200, 28800, 36000];

export const BASE_BANDS = [
  { name: "700-1400", low: 700, high: 1400 },
  { name: "1400-2800", low: 1400, high: 2800 },
  { name: "2800-5600", low: 2800, high: 5600 },
  { name: "5600-10000", low: 5600, high: 10000 },
  { name: "10000-16000", low: 10000, high: 16000 },
];

export const DEFAULT_PERIOD_SECONDS = 10;
export const DEFAULT_FEATURE_RATE = 1000;
export const DEFAULT_BIN_COUNT = 128;
export const DEFAULT_FEATURE_CAP = 2;
export const MIN_PERIOD_SECONDS = 2;
export const MAX_PERIOD_SECONDS = 30;

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const supportedBands = (sampleRate) => {
  const nyquist = sampleRate / 2;
  return BASE_BANDS.filter((band) => band.high < nyquist * 0.92);
};

export const mean = (values) => {
  if (!values.length) return 0;
  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    total += values[index];
  }
  return total / values.length;
};

export const normalizeRow = (row) => {
  const rowMean = mean(row);
  let variance = 0;

  for (let index = 0; index < row.length; index += 1) {
    const diff = row[index] - rowMean;
    variance += diff * diff;
  }

  const rowStd = Math.sqrt(variance / Math.max(1, row.length));
  const scale = Math.max(rowStd, 1e-6);
  const normalized = new Float32Array(row.length);

  for (let index = 0; index < row.length; index += 1) {
    normalized[index] = (row[index] - rowMean) / scale;
  }

  return normalized;
};
