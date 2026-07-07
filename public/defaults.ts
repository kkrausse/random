export const DEFAULT_PERIOD_SECONDS = 6;
export const DEFAULT_LIFT_ANGLE_DEGREES = 52;
export const DEFAULT_FEATURE_RATE = 2**13;
export const DEFAULT_BIN_COUNT = 64;
export const DEFAULT_TRACKING_FOLD_BIN_COUNT = 4096;
export const DEFAULT_FEATURE_POST_FRAME_COUNT = 2048;
export const DEFAULT_ANALYSIS_INTERVAL_MS = 300;
export const DEFAULT_FEATURE_LOG_GAIN = 100;
export const MIN_PERIOD_SECONDS = 2;
export const MAX_PERIOD_SECONDS = 30;

export const CANDIDATE_BPH = [14400, 18000, 19800, 21600, 25200, 28800, 36000];

export const BASE_BANDS = [
  { name: "4000-5600", low: 4000, high: 5600 },
  { name: "5600-7500", low: 5600, high: 7500 },
  { name: "7500-10000", low: 7500, high: 10000 },
  { name: "10000-12000", low: 10000, high: 14000 },
  { name: "12000-14000", low: 10000, high: 14000 },
  { name: "14000-20000", low: 14000, high: 20000 },
];
