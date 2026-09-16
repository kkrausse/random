import { expect, test } from "bun:test";
import { stripPlan, orientRgba } from "./strip-plan.js";

test("strips cover every output row exactly once with Bayer-aligned overlap", () => {
  for (const height of [4168, 4170, 8]) {
    for (const count of [1, 2, 4]) {
      for (const half of [true, false]) {
        const scale = half ? 2 : 1;
        const plan = stripPlan(6240, height, count, half);
        let end = 0;
        for (const strip of plan) {
          expect(strip.y).toBe(end);
          expect(strip.height).toBeGreaterThan(0);
          expect(strip.cropbox[1] % 2).toBe(0);
          expect(strip.cropbox[3] % 2).toBe(0);
          expect(strip.cropbox[1] + strip.skip * scale).toBe(strip.y * scale);
          expect((strip.skip + strip.height) * scale).toBeLessThanOrEqual(strip.cropbox[3]);
          end += strip.height;
        }
        expect(end).toBe(height / scale);
      }
    }
  }
});

test("rejects unsupported geometry and worker counts", () => {
  expect(() => stripPlan(6239, 4168, 2, false)).toThrow();
  expect(() => stripPlan(6240, 4167, 2, false)).toThrow();
  expect(() => stripPlan(6240, 4168, 3, false)).toThrow();
  expect(() => stripPlan(6240, 4, 4, false)).toThrow();
});

test("camera orientation preserves pixels and rotates rectangular images correctly", () => {
  const source = new Uint8ClampedArray([1, 2, 3, 4, 5, 6].flatMap(v => [v, v, v, 255]));
  const expected = [
    [1, 2, 3, 4, 5, 6], [3, 2, 1, 6, 5, 4],
    [4, 5, 6, 1, 2, 3], [6, 5, 4, 3, 2, 1],
    [1, 4, 2, 5, 3, 6], [3, 6, 2, 5, 1, 4],
    [4, 1, 5, 2, 6, 3], [6, 3, 5, 2, 4, 1],
  ];
  for (let flip = 0; flip < 8; flip++) {
    const result = orientRgba(source, 3, 2, flip);
    expect(result.width).toBe(flip & 4 ? 2 : 3);
    expect(result.height).toBe(flip & 4 ? 3 : 2);
    expect([...result.rgba].filter((_, i) => i % 4 === 0)).toEqual(expected[flip]);
  }
});
