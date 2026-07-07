export const DEFAULT_PERIOD_SECONDS = 3;
export const DEFAULT_LIFT_ANGLE_DEGREES = 52;
export const DEFAULT_FEATURE_RATE = 2**14;
export const DEFAULT_BIN_COUNT = 32;
export const DEFAULT_TRACKING_FOLD_BIN_COUNT = 2**13;
export const DEFAULT_FEATURE_POST_FRAME_COUNT = 2**11;
export const DEFAULT_ANALYSIS_INTERVAL_MS = 300;
export const DEFAULT_FEATURE_LOG_GAIN = 20;
export const MIN_PERIOD_SECONDS = 1;
export const MAX_PERIOD_SECONDS = 30;

export const CANDIDATE_BPH = [14400, 18000, 19800, 21600, 25200, 28800, 36000];

export const BASE_BANDS = [
  { name: "7500-10000", low: 7500, high: 10000 },
  { name: "10000-12000", low: 10000, high: 14000 },
  { name: "12000-14000", low: 10000, high: 14000 },
  { name: "14000-20000", low: 14000, high: 20000 },
];
