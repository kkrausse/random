import { expect, test } from "bun:test";
import { WheelAccumulator } from "./scroll";

test("tiny trackpad events accumulate instead of each producing a scroll step", () => {
  const wheel = new WheelAccumulator();
  let steps = 0;
  for (let i = 0; i < 100; i++) steps += wheel.steps(1, 0, 20, 30, "mouse", i);
  expect(steps).toBe(2);
  expect(wheel.steps(-60, 0, 20, 30, "mouse", 101)).toBe(-1);
});

test("sensitivity scales scroll speed", () => {
  const slow = new WheelAccumulator(0.35);
  const fast = new WheelAccumulator(1);
  expect(slow.steps(3, 1, 20, 30, "history", 0)).toBe(1);
  expect(fast.steps(3, 1, 20, 30, "history", 0)).toBe(3);
});

test("line/page deltas are normalized, bursts capped, and fractions expire", () => {
  const wheel = new WheelAccumulator();
  expect(wheel.steps(3, 1, 20, 30, "history", 0)).toBe(1);
  expect(wheel.steps(1, 2, 20, 30, "history", 10)).toBe(8);
  expect(wheel.steps(2, 1, 20, 30, "history", 1000)).toBe(1);
  expect(wheel.steps(1, 1, 20, 30, "mouse", 1001)).toBe(0);
});
