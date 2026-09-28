import { expect, test } from "bun:test";
import { DEFAULT_SEARCH_PREFERENCES } from "./search";
import { DEFAULT_CONFIG, parseConfig, resolveStart, serializeConfig } from "./url-config";

test("empty links use the shared search defaults", () => {
  expect(parseConfig("")).toEqual(DEFAULT_CONFIG);
  expect(parseConfig("").preferences).toEqual(DEFAULT_SEARCH_PREFERENCES);
});

test("all search and display configuration survives a URL roundtrip", () => {
  const config = { ...DEFAULT_CONFIG, start: "90005820", minKm: 3.218688, maxKm: 16.09344,
    mode: "gravel" as const, shape: "out-and-back" as const, seed: 1024,
    preferences: { motorcar: -5, motorcycle: 5, bicycle: 2 },
    units: "km" as const, sort: "road" as const, accessMode: "motorcar" as const };
  const query = serializeConfig(config, "?campaign=friend&car=0&start=wrong");
  expect(parseConfig(query)).toEqual(config);
  expect(new URLSearchParams(query).getAll("start")).toEqual(["90005820"]);
  expect(new URLSearchParams(query).get("campaign")).toBe("friend");
});

test("malformed, nonfinite, out-of-range and contradictory values fall back safely", () => {
  const result = parseConfig("?region=unknown&start=-4&mode=drive&shape=spiral&minKm=12&maxKm=2&seed=NaN&car=5.5&motorcycle=99&bicycle=-6&units=feet&sort=whatever&access=foot");
  expect(result).toEqual(DEFAULT_CONFIG);
  expect(parseConfig("?minKm=Infinity&maxKm=-1&seed=2147483648&car=Infinity&start=1e3")).toEqual(DEFAULT_CONFIG);
  expect(parseConfig("?minKm=2&maxKm=8&seed=0&car=0&motorcycle=-5&bicycle=5&start=0")).toMatchObject({
    start: "0", minKm: 2, maxKm: 8, seed: 0, preferences: { motorcar: 0, motorcycle: -5, bicycle: 5 },
  });
});

test("start IDs resolve independently of package array ordering, with a safe fallback", () => {
  const nodes = [{ id: "90005821" }, { id: "90005820" }];
  expect(resolveStart(nodes, "90005820", 0)).toBe(1);
  expect(resolveStart(nodes, "90005821", 1)).toBe(0);
  expect(resolveStart(nodes, "missing", 1)).toBe(1);
});
