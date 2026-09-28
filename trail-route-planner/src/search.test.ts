import { test, expect } from "bun:test";
import { Schema } from "effect";
import { Region, SearchPreferences, analyze, interpret, type Way } from "./domain";
import { adjacency, generate, meetsRequirements, preferencePenalty } from "./search";

const region = Schema.decodeUnknownSync(Region)(await Bun.file(new URL("../public/kings-beach.json", import.meta.url)).json());

test("regional package is real OSM topology with attributable raw way and node tags", () => {
  expect(region.source.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(region.source.osmBaseTimestamp).toMatch(/^2026-/);
  expect(region.nodes.length).toBeGreaterThan(8000);
  expect(region.edges.length).toBeGreaterThan(9000);
  expect(region.ways.some(w => w.tags.motorcycle || w.tags.bicycle)).toBe(true);
  for (const e of region.edges) { expect(e.a).toBeLessThan(region.nodes.length); expect(e.b).toBeLessThan(region.nodes.length); expect(e.way).toBeLessThan(region.ways.length); }
});

test("incompatible package version is rejected at boundary", () => {
  expect(() => Schema.decodeUnknownSync(Region)({ ...region, format: 2 })).toThrow();
});

test("access preferences accept only whole slider settings from -5 through +5", () => {
  const decode = Schema.decodeUnknownSync(SearchPreferences);
  expect(decode({ motorcar: -5, motorcycle: 0, bicycle: 5 })).toEqual({ motorcar: -5, motorcycle: 0, bicycle: 5 });
  expect(() => decode({ motorcar: 5.5, motorcycle: 0, bicycle: 0 })).toThrow();
  expect(() => decode({ motorcar: -6, motorcycle: 0, bicycle: 0 })).toThrow();
});

test("absence does not assert prohibition; explicit priority and inferred are separate", () => {
  expect(interpret({ highway: "path" }, "motorcycle")).toEqual({ access: "unknown", basis: "unknown" });
  expect(interpret({ highway: "footway" }, "foot")).toEqual({ access: "permitted", basis: "inferred", tag: "highway", value: "footway" });
  expect(interpret({ access: "yes", motorcycle: "no" }, "motorcycle")).toEqual({ access: "prohibited", basis: "explicit", tag: "motorcycle", value: "no" });
  expect(interpret({ motorcycle: "conditional" }, "motorcycle").access).toBe("restricted");
});

test("car and motorcycle coloring uses their own tags before shared vehicle access", () => {
  const tags = { highway: "track", motorcycle: "yes", motorcar: "no", motor_vehicle: "private" };
  expect(interpret(tags, "motorcycle")).toEqual({ access: "permitted", basis: "explicit", tag: "motorcycle", value: "yes" });
  expect(interpret(tags, "motorcar")).toEqual({ access: "prohibited", basis: "explicit", tag: "motorcar", value: "no" });
  expect(interpret({ motor_vehicle: "yes" }, "motorcar")).toEqual({ access: "permitted", basis: "explicit", tag: "motor_vehicle", value: "yes" });
  expect(interpret({ highway: "residential" }, "motorcar")).toEqual({ access: "permitted", basis: "inferred", tag: "highway", value: "residential" });
  expect(interpret({ motorcar: "no" }, "motorcycle")).toEqual({ access: "unknown", basis: "unknown" });
  expect(interpret({ motorcar: "destination" }, "motorcar").access).toBe("restricted");
});

test("car preference infers ordinary streets and paths but leaves ambiguous tracks unresolved", () => {
  for (const highway of ["residential", "service", "primary", "motorway"]) {
    expect(interpret({ highway }, "motorcar")).toEqual({ access: "permitted", basis: "inferred", tag: "highway", value: highway });
  }
  for (const highway of ["footway", "path", "cycleway", "steps"]) {
    expect(interpret({ highway }, "motorcar")).toEqual({ access: "prohibited", basis: "inferred", tag: "highway", value: highway });
  }
  expect(interpret({ highway: "track" }, "motorcar")).toEqual({ access: "unknown", basis: "unknown" });
  expect(interpret({ highway: "service", access: "private" }, "motorcar").access).toBe("prohibited");
  expect(interpret({ highway: "residential", motor_vehicle: "destination" }, "motorcar").access).toBe("restricted");
  expect(interpret({ highway: "path", motorcar: "yes" }, "motorcar").access).toBe("permitted");
  expect(interpret({ highway: "residential" }, "motorcycle").access).toBe("unknown");

  const street = region.edges.findIndex(edge => region.ways[edge.way].tags.highway === "residential" && !["motorcar", "motor_vehicle", "vehicle", "access"].some(key => region.ways[edge.way].tags[key]));
  expect(street).toBeGreaterThanOrEqual(0);
  const route = analyze(region, [street], [region.edges[street].a, region.edges[street].b], "street");
  const neutral = { motorcar: 0, motorcycle: 0, bicycle: 0 };
  expect(route.exposure.motorcar.permitted).toBeCloseTo(route.km);
  expect(route.evidence.motorcar.inferred).toBeCloseTo(route.km);
  expect(preferencePenalty(route, { ...neutral, motorcar: -5 })).toBeCloseTo(route.km * 4);
  expect(meetsRequirements(route, { ...neutral, motorcar: 5 })).toBe(true);
});

test("repeat traversal counts twice but unique edge once; attributes overlap", () => {
  const e = region.edges.findIndex(edge => region.ways[edge.way].tags.motorcycle === "designated");
  expect(e).toBeGreaterThanOrEqual(0);
  const r = analyze(region, [e, e], [region.edges[e].a, region.edges[e].b, region.edges[e].a], "repeated");
  expect(r.km).toBeCloseTo(r.uniqueKm * 2, 7);
  expect(r.exposure.motorcycle.permitted).toBeCloseTo(r.km, 7);
});

test("access sliders rank permitted coverage without treating unknown as permission", () => {
  const ways: Way[] = [
    { ...region.ways[0], tags: { highway: "path", motorcar: "yes", motorcycle: "no", bicycle: "yes" } },
    { ...region.ways[0], tags: { highway: "path", motorcycle: "yes" } },
  ];
  const example = { ...region, ways, edges: [
    { ...region.edges[0], way: 0, meters: region.edges[0].meters },
    { ...region.edges[0], way: 1, meters: region.edges[0].meters },
  ] };
  const route = analyze(example, [0, 1], [0, 1, 0], "mixed");
  const neutral = { motorcar: 0, motorcycle: 0, bicycle: 0 };
  expect(route.exposure.motorcar.permitted).toBeCloseTo(route.km / 2);
  expect(route.exposure.motorcar.prohibited).toBeCloseTo(route.km / 2);
  expect(preferencePenalty(route, neutral)).toBe(0);
  expect(preferencePenalty(route, { ...neutral, motorcycle: -5 })).toBeCloseTo(route.km * 2);
  expect(preferencePenalty(route, { ...neutral, motorcycle: 5 })).toBeCloseTo(route.km * 2);
  expect(meetsRequirements(route, { ...neutral, motorcar: 5 })).toBe(false);
  expect(meetsRequirements(route, { ...neutral, motorcar: 4 })).toBe(true);
  const almost = { ...route, exposure: { ...route.exposure, motorcar: { ...route.exposure.motorcar, permitted: route.km * 0.9 } } };
  expect(meetsRequirements(almost, { ...neutral, motorcar: 5 })).toBe(true);
  expect(meetsRequirements({ ...almost, exposure: { ...almost.exposure, motorcar: { ...almost.exposure.motorcar, permitted: route.km * 0.89 } } }, { ...neutral, motorcar: 5 })).toBe(false);
  expect(meetsRequirements(analyze(example, [0], [0, 1], "car"), { ...neutral, motorcar: 5, bicycle: 5 })).toBe(true);
  expect(meetsRequirements(analyze(example, [1], [0, 1], "car-free-path"), { ...neutral, motorcar: 5 })).toBe(false);
});

test("real Kings Beach candidate paths are continuous, reproducible, deduplicated and mode-feasible", () => {
  const adj = adjacency(region);
  const start = 3007; // OSM node 4147514531, connected Kings Beach trail entrance vicinity
  const request = { start, minKm: 3, maxKm: 9, mode: "hike" as const, shape: "loop" as const, seed: 3, preferences: { motorcar: 0, motorcycle: 0, bicycle: 0 } };
  const routes = generate(region, request);
  expect(routes.length).toBeGreaterThan(3);
  expect(generate(region, request).map(r => r.id)).toEqual(routes.map(r => r.id));
  for (const r of routes) {
    expect(r.nodes[0]).toBe(start); expect(r.nodes.at(-1)).toBe(start);
    expect(r.nodes.length).toBe(r.edges.length + 1);
    expect(r.uniqueKm).toBeLessThanOrEqual(r.km);
    for (let i = 0; i < r.edges.length; i++) expect(adj[r.nodes[i]].some(s => s.edge === r.edges[i] && s.to === r.nodes[i + 1])).toBe(true);
    expect(Object.values(r.exposure.motorcycle).reduce((sum, km) => sum + km, 0)).toBeCloseTo(r.km, 7);
  }
  const backs = generate(region, { ...request, shape: "out-and-back" });
  expect(backs.length).toBeGreaterThan(2);
  for (const r of backs) expect(r.km).toBeCloseTo(r.uniqueKm * 2, 6);
  const required = generate(region, { ...request, preferences: { ...request.preferences, motorcar: 5 } });
  for (const r of required) expect(r.exposure.motorcar.permitted / r.km).toBeGreaterThanOrEqual(0.9 - 1e-9);
});
