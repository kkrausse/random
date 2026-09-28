import { expect, test } from "bun:test";
import { displayDistance, inputDistance, KM_PER_MILE, toKilometers } from "./units";

test("miles are the display unit while search distances remain kilometers", () => {
  expect(toKilometers(2, "mi")).toBe(2 * KM_PER_MILE);
  expect(displayDistance(2 * KM_PER_MILE, "mi")).toBe("2.0");
  expect(inputDistance(2 * KM_PER_MILE, "km")).toBe(3.2);
  expect(toKilometers(inputDistance(2 * KM_PER_MILE, "mi"), "mi")).toBe(2 * KM_PER_MILE);
});

test("switching units never changes the underlying search range", () => {
  const rangeKm = [toKilometers(2, "mi"), toKilometers(6, "mi")];
  expect(rangeKm.map(value => displayDistance(value, "mi"))).toEqual(["2.0", "6.0"]);
  expect(rangeKm.map(value => displayDistance(value, "km"))).toEqual(["3.2", "9.7"]);
  expect(rangeKm).toEqual([2 * KM_PER_MILE, 6 * KM_PER_MILE]);
});
