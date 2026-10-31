// Per-user mapping from iTracker output to screen pixels, fitted on the 9 calibration dots.
// (Same fitting as the UniGaze page, gaze-unigaze/src/calib.ts, with iTracker's features.)
//
// Base feature: iTracker's (x, y) in cm on the camera plane. "uncal" maps that with the
// assumed screen geometry (camera centred camAboveTopMm above the display, display in the
// camera plane). The fitted mappings are ridge regressions on standardized features:
//   affine:    [x, y]
//   quadratic: [x, y, x², y², x·y]
//   head:      affine + [face-box centre x, y (fraction of frame), face-box width (fraction)]
// Each is scored by leave-one-dot-out error on the calibration data; the best drives the
// live cursor, and all are reported on the post-calibration test.
import type { Frame } from "./remote";

export type Pt = [number, number];
export type MappingName = "affine" | "quadratic" | "head";
export const MAPPINGS: MappingName[] = ["affine", "quadratic", "head"];

export interface Geometry {
  pxPerMm: number; // CSS px per mm of display
  camAboveTopMm: number; // camera lens centre above the top edge of the viewport
  viewportW: number;
}

// GazeCapture camera space: x toward the user's right (= screen right), y up, cm.
export function uncalibrated(f: Frame, g: Geometry): Pt {
  return [g.viewportW / 2 + f.gaze[0] * 10 * g.pxPerMm, (-f.gaze[1] * 10 - g.camAboveTopMm) * g.pxPerMm];
}

export function features(f: Frame, m: MappingName): number[] {
  const [x, y] = f.gaze;
  if (m === "affine") return [x, y];
  if (m === "quadratic") return [x, y, x * x, y * y, x * y];
  const [fx, fy, fw] = f.face;
  return [x, y, (fx + fw / 2) / f.W, (fy + fw / 2) / f.H, fw / f.W];
}

export interface Fit {
  name: MappingName;
  mu: number[];
  sd: number[];
  wx: number[];
  wy: number[];
  looCm: number; // leave-one-dot-out mean error of per-dot means, cm
}

interface Sample { f: Frame; target: Pt; dot: number }

export function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

function ridge(X: number[][], y: number[], lambda: number): number[] {
  const p = X[0].length;
  const A = Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => X.reduce((s, r) => s + r[a] * r[b], 0) + (a === b && a > 0 ? lambda : 0)));
  const b = Array.from({ length: p }, (_, a) => X.reduce((s, r, i) => s + r[a] * y[i], 0));
  return solve(A, b);
}

function fitRaw(samples: Sample[], m: MappingName, lambda: number) {
  const F = samples.map((s) => features(s.f, m));
  const p = F[0].length;
  const mu = Array.from({ length: p }, (_, j) => F.reduce((a, r) => a + r[j], 0) / F.length);
  const sd = Array.from({ length: p }, (_, j) => Math.sqrt(F.reduce((a, r) => a + (r[j] - mu[j]) ** 2, 0) / F.length) || 1);
  const X = F.map((r) => [1, ...r.map((v, j) => (v - mu[j]) / sd[j])]);
  // lambda scales with sample count so it means the same with 150 or 300 frames.
  const wx = ridge(X, samples.map((s) => s.target[0]), lambda * samples.length);
  const wy = ridge(X, samples.map((s) => s.target[1]), lambda * samples.length);
  return { mu, sd, wx, wy };
}

export function apply(fit: Pick<Fit, "mu" | "sd" | "wx" | "wy" | "name">, f: Frame): Pt {
  const r = features(f, fit.name);
  const x = [1, ...r.map((v, j) => (v - fit.mu[j]) / fit.sd[j])];
  return [x.reduce((a, v, j) => a + v * fit.wx[j], 0), x.reduce((a, v, j) => a + v * fit.wy[j], 0)];
}

const LAMBDA: Record<MappingName, number> = { affine: 1e-3, quadratic: 0.05, head: 0.05 };

export function fitAll(samples: Sample[], pxPerCm: number): Fit[] {
  const dots = [...new Set(samples.map((s) => s.dot))];
  return MAPPINGS.map((name) => {
    const full = fitRaw(samples, name, LAMBDA[name]);
    const errs = dots.map((d) => {
      const train = samples.filter((s) => s.dot !== d);
      const test = samples.filter((s) => s.dot === d);
      const fr = { name, ...fitRaw(train, name, LAMBDA[name]) };
      const ps = test.map((s) => apply(fr, s.f));
      const mx = ps.reduce((a, p) => a + p[0], 0) / ps.length, my = ps.reduce((a, p) => a + p[1], 0) / ps.length;
      return Math.hypot(mx - test[0].target[0], my - test[0].target[1]) / pxPerCm;
    });
    return { name, ...full, looCm: errs.reduce((a, b) => a + b, 0) / errs.length };
  });
}
