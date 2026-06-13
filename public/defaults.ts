export const DEFAULT_PERIOD_SECONDS = 10;
export const DEFAULT_FEATURE_RATE = 4000;
export const DEFAULT_BIN_COUNT = 128;
export const DEFAULT_TRACKING_FOLD_BIN_COUNT = 1024;
export const DEFAULT_FEATURE_CAP = 2;
export const DEFAULT_FEATURE_POST_FRAME_COUNT = 64;
export const DEFAULT_FEATURE_LOG_GAIN = 2000;
export const MIN_PERIOD_SECONDS = 2;
export const MAX_PERIOD_SECONDS = 30;

export const CANDIDATE_BPH = [14400, 18000, 19800, 21600, 25200, 28800, 36000];

export const BASE_BANDS = [
  { name: "700-1400", low: 700, high: 1400 },
  { name: "1400-2800", low: 1400, high: 2800 },
  { name: "2800-5600", low: 2800, high: 5600 },
  { name: "5600-10000", low: 5600, high: 10000 },
  { name: "10000-16000", low: 10000, high: 16000 },
];
