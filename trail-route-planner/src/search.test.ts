import { test, expect } from "bun:test";
import { Schema } from "effect";
import { Region, SearchPreferences, analyze, interpret, type Way } from "./domain";
import { adjacency, DEFAULT_SEARCH_PREFERENCES, NEUTRAL_SEARCH_PREFERENCES, generate, preferencePenalty } from "./search";
import { describeVehicleIntensity, regionVehicleIntensity } from "./intensity";

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
});

test("repeat traversal counts twice but unique edge once; attributes overlap", () => {
  const e = region.edges.findIndex(edge => region.ways[edge.way].tags.motorcycle === "designated");
  expect(e).toBeGreaterThanOrEqual(0);
  const r = analyze(region, [e, e], [region.edges[e].a, region.edges[e].b, region.edges[e].a], "repeated");
  expect(r.km).toBeCloseTo(r.uniqueKm * 2, 7);
  expect(r.exposure.motorcycle.permitted).toBeCloseTo(r.km, 7);
});

test("vehicle sliders rank intensity, bicycle ranks permitted coverage, and +5 is soft", () => {
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
  expect(preferencePenalty(route, { ...neutral, motorcycle: 5 })).toBeCloseTo(route.km * 4);
  expect(preferencePenalty(route, { ...neutral, bicycle: 5 })).toBeCloseTo(route.km * 2);
  expect(preferencePenalty(route, { ...neutral, motorcar: 5 })).toBeGreaterThan(0);
});

test("negative car preference discovers a tagged car-free route rather than treating an unknown track as car-free", () => {
  const small = Schema.decodeUnknownSync(Region)({
    ...region,
    nodes: Array.from({ length: 5 }, (_, i) => ({ id: String(i), lat: 39 + (i === 2 ? 0.009 : 0.0005), lon: -120, tags: {} })),
    ways: [
      { id: "1", tags: { highway: "path", motorcar: "yes" } },
      { id: "2", tags: { highway: "track" } },
      { id: "3", tags: { highway: "track", motorcar: "no", motor_vehicle: "yes" } },
    ],
    edges: [
      { a: 0, b: 4, way: 0, meters: 800 }, { a: 4, b: 2, way: 0, meters: 800 },
      { a: 0, b: 3, way: 1, meters: 850 }, { a: 3, b: 2, way: 1, meters: 850 },
      { a: 0, b: 1, way: 2, meters: 1000 }, { a: 1, b: 2, way: 2, meters: 1000 },
    ],
  });
  const neutral = { motorcar: 0, motorcycle: 0, bicycle: 0 };
  const request = { start: 0, minKm: 3.1, maxKm: 4.1, mode: "hike" as const, shape: "out-and-back" as const, seed: 2, preferences: neutral };
  const baseline = generate(small, request);
  const avoiding = generate(small, { ...request, preferences: { ...neutral, motorcar: -5 } });
  expect(baseline[0].km).toBeCloseTo(3.2);
  expect(new Set(baseline.map(r => r.edges.join(",")))).toEqual(new Set(avoiding.map(r => r.edges.join(","))));
  expect(baseline[0].exposure.motorcar.permitted).toBeCloseTo(3.2); // explicit yes overrides path inference
  expect(avoiding[0].km).toBeCloseTo(4);
  expect(avoiding[0].exposure.motorcar.prohibited).toBeCloseTo(4); // motorcar=no overrides motor_vehicle=yes
  expect(avoiding[0].exposure.motorcar.unknown).toBe(0);

  const withoutCarFree = { ...small, edges: small.edges.slice(0, 4) };
  const fallback = generate(withoutCarFree, { ...request, preferences: { ...neutral, motorcar: -5 } });
  expect(fallback.length).toBeGreaterThan(0);
  expect(fallback[0].intensity.motorcar.unknownKm).toBeGreaterThan(0);
  expect(generate(small, { ...request, minKm: 3.25, maxKm: 3.3, preferences: { ...neutral, motorcar: -5 } })).toEqual([]);
});

test("sliders only rerank the same candidates at every position, including combined extremes", () => {
  expect(DEFAULT_SEARCH_PREFERENCES).toEqual({ motorcar: 0, motorcycle: 0, bicycle: 0 });
  expect(NEUTRAL_SEARCH_PREFERENCES).toEqual({ motorcar: 0, motorcycle: 0, bicycle: 0 });
  const request = { start: 3007, minKm: 3.21868, maxKm: 9.65604, mode: "hike" as const,
    shape: "loop" as const, seed: 3, preferences: NEUTRAL_SEARCH_PREFERENCES };
  const neutral = generate(region, request);
  const signatures = (routes: ReturnType<typeof generate>) => routes.map(r => `${r.id}:${r.edges.join(",")}`).sort();
  expect(neutral.length).toBeGreaterThan(2);
  const variants = [
    ...([-5, -3, -1, 0, 1, 3, 5] as const).flatMap(value => (["motorcar", "motorcycle", "bicycle"] as const)
      .map(key => ({ ...NEUTRAL_SEARCH_PREFERENCES, [key]: value }))),
    { motorcar: -5, motorcycle: 5, bicycle: -5 },
    { motorcar: 5, motorcycle: -5, bicycle: 5 },
    { motorcar: -5, motorcycle: -5, bicycle: -5 },
    { motorcar: 5, motorcycle: 5, bicycle: 5 },
  ];
  for (const preferences of variants) {
    const routes = generate(region, { ...request, preferences });
    expect(signatures(routes)).toEqual(signatures(neutral));
    for (const route of routes) expect(route.km).toBeGreaterThanOrEqual(request.minKm - 1e-6);
  }
  expect(generate(region, { ...request, preferences: { ...NEUTRAL_SEARCH_PREFERENCES, motorcar: -5 } })[0].id).not.toBe(neutral[0].id);
}, 40_000);

test("fixed neutral discovery retains a valid road route when an avoidance detour exceeds range", () => {
  const small = Schema.decodeUnknownSync(Region)({ ...region,
    nodes: [[39, -120], [39.0005, -120], [39.009, -120], [39.0005, -119.999]].map(([lat, lon], i) => ({ id: String(i), lat, lon, tags: {} })),
    ways: [{ id: "1", tags: { highway: "residential", foot: "yes" } }, { id: "2", tags: { highway: "path", motor_vehicle: "no" } }],
    edges: [
      { a: 0, b: 1, way: 0, meters: 900 }, { a: 1, b: 2, way: 0, meters: 900 },
      { a: 0, b: 3, way: 1, meters: 1500 }, { a: 3, b: 2, way: 1, meters: 1500 },
    ],
  });
  const request = { start: 0, minKm: 3.4, maxKm: 4, mode: "hike" as const,
    shape: "out-and-back" as const, seed: 2, preferences: NEUTRAL_SEARCH_PREFERENCES };
  const expected = generate(small, request);
  expect(expected).toHaveLength(1);
  expect(expected[0].km).toBeCloseTo(3.6);
  expect(expected[0].roadKm).toBeCloseTo(3.6);
  for (const motorcar of [-5, -1, 0, 1, 5]) {
    const routes = generate(small, { ...request, preferences: { motorcar, motorcycle: -5, bicycle: 5 } });
    expect(routes.map(r => r.edges)).toEqual(expected.map(r => r.edges));
  }
});

test("car-road-only connected graph survives private/foot/bicycle tags, barriers, oneway and every slider position", () => {
  // The bundled region has hundreds of service roads tagged access=private,
  // plus residential/service oneways. A road-only neighborhood must not vanish.
  const roadOnly = Schema.decodeUnknownSync(Region)({ ...region,
    nodes: [[39, -120], [39.0005, -120], [39.009, -120]].map(([lat, lon], i) =>
      ({ id: String(i), lat, lon, tags: i === 1 ? { barrier: "bollard" } : {} })),
    ways: [{ id: "1", tags: { highway: "service", access: "private", foot: "no", bicycle: "no", oneway: "-1" } }],
    edges: [{ a: 0, b: 1, way: 0, meters: 900 }, { a: 1, b: 2, way: 0, meters: 900 }],
  });
  const variants = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
  for (const mode of ["hike", "gravel"] as const) for (const shape of ["loop", "out-and-back"] as const) {
    const request = { start: 0, minKm: 3.4, maxKm: 4, mode, shape, seed: 2, preferences: DEFAULT_SEARCH_PREFERENCES };
    const baseline = generate(roadOnly, request);
    expect(baseline).toHaveLength(1);
    expect(baseline[0].km).toBeCloseTo(3.6);
    expect(baseline[0].roadKm).toBeCloseTo(3.6);
    expect(baseline[0].exposure.motorcar.prohibited).toBeCloseTo(3.6);
    const signatures = baseline.map(r => `${r.id}:${r.nodes.join(",")}:${r.edges.join(",")}`);
    for (const value of variants) for (const key of ["motorcar", "motorcycle", "bicycle"] as const) {
      const routes = generate(roadOnly, { ...request, preferences: { ...DEFAULT_SEARCH_PREFERENCES, [key]: value } });
      expect(routes.map(r => `${r.id}:${r.nodes.join(",")}:${r.edges.join(",")}`)).toEqual(signatures);
    }
    for (const value of variants) {
      const routes = generate(roadOnly, { ...request, preferences: { motorcar: value, motorcycle: -value, bicycle: value } });
      expect(routes.map(r => `${r.id}:${r.nodes.join(",")}:${r.edges.join(",")}`)).toEqual(signatures);
    }
  }
});

test("mixed road alternatives remain in the pool but only explicit preferences rerank them", () => {
  const mixed = Schema.decodeUnknownSync(Region)({ ...region,
    nodes: [[39, -120], [39.0005, -120], [39.009, -120], [39.0005, -119.999]].map(([lat, lon], i) =>
      ({ id: String(i), lat, lon, tags: {} })),
    ways: [{ id: "1", tags: { highway: "residential", foot: "no", bicycle: "no" } },
      { id: "2", tags: { highway: "track", motorcar: "no", foot: "yes", bicycle: "yes" } }],
    edges: [{ a: 0, b: 1, way: 0, meters: 900 }, { a: 1, b: 2, way: 0, meters: 900 },
      { a: 0, b: 3, way: 1, meters: 1000 }, { a: 3, b: 2, way: 1, meters: 1000 }],
  });
  const request = { start: 0, minKm: 3.4, maxKm: 4.1, mode: "hike" as const,
    shape: "out-and-back" as const, seed: 2, preferences: DEFAULT_SEARCH_PREFERENCES };
  const neutral = generate(mixed, request);
  expect(neutral).toHaveLength(2);
  expect(neutral[0].roadKm).toBeCloseTo(3.6);
  const signatures = neutral.map(r => `${r.id}:${r.edges.join(",")}`).sort();
  for (const value of [-5, -1, 0, 1, 5]) {
    const routes = generate(mixed, { ...request, preferences: { motorcar: value, motorcycle: value, bicycle: value } });
    expect(routes.map(r => `${r.id}:${r.edges.join(",")}`).sort()).toEqual(signatures);
    expect(routes).toHaveLength(2);
  }
  expect(generate(mixed, { ...request, preferences: { ...DEFAULT_SEARCH_PREFERENCES, motorcar: -5 } })[0].trailKm).toBeCloseTo(4);
});

test("real Kings Beach candidate paths are continuous, reproducible, deduplicated and mode-feasible", () => {
  const adj = adjacency(region);
  const start = 3007; // OSM node 4147514531, connected Kings Beach trail entrance vicinity
  const request = { start, minKm: 3, maxKm: 9, mode: "hike" as const, shape: "loop" as const, seed: 3, preferences: { motorcar: 0, motorcycle: 0, bicycle: 0 } };
  const routes = generate(region, request);
  expect(routes.length).toBeGreaterThan(3);
  expect(generate(region, request).map(r => r.id)).toEqual(routes.map(r => r.id));
  for (const r of routes) {
    expect(r.km).toBeGreaterThanOrEqual(request.minKm - 1e-6);
    expect(r.km).toBeLessThanOrEqual(request.maxKm + 1e-6);
    expect(r.nodes[0]).toBe(start); expect(r.nodes.at(-1)).toBe(start);
    expect(r.nodes.length).toBe(r.edges.length + 1);
    expect(r.uniqueKm).toBeLessThanOrEqual(r.km);
    for (let i = 0; i < r.edges.length; i++) expect(adj[r.nodes[i]].some(s => s.edge === r.edges[i] && s.to === r.nodes[i + 1])).toBe(true);
    expect(Object.values(r.exposure.motorcycle).reduce((sum, km) => sum + km, 0)).toBeCloseTo(r.km, 7);
  }
  const backs = generate(region, { ...request, shape: "out-and-back" });
  expect(backs.length).toBeGreaterThan(2);
  for (const r of backs) {
    expect(r.km).toBeGreaterThanOrEqual(request.minKm - 1e-6);
    expect(r.km).toBeLessThanOrEqual(request.maxKm + 1e-6);
    expect(r.km).toBeCloseTo(r.uniqueKm * 2, 6);
  }
  const favored = generate(region, { ...request, preferences: { ...request.preferences, motorcar: 5 } });
  expect(favored.length).toBeGreaterThan(0);
  for (const r of favored) expect(r.km).toBeGreaterThanOrEqual(request.minKm);
  expect(favored.some(r => r.exposure.motorcar.permitted / r.km < 0.9)).toBe(true);
  const motoFavored = generate(region, { ...request, preferences: { ...request.preferences, motorcycle: 5 } });
  expect(motoFavored.length).toBeGreaterThan(0);
  expect(motoFavored.some(r => r.exposure.motorcycle.permitted / r.km < 0.9)).toBe(true);
});

test("2–6 mile loop favors less car intensity at −5 without relaxing the range", () => {
  const request = { start: 3007, minKm: 3.21868, maxKm: 9.65604, mode: "hike" as const, shape: "loop" as const, seed: 3,
    preferences: { motorcar: 0, motorcycle: 0, bicycle: 0 } };
  const neutral = generate(region, request);
  const avoiding = generate(region, { ...request, preferences: { ...request.preferences, motorcar: -5 } });
  expect(avoiding.length).toBeGreaterThan(0);
  for (const route of avoiding) {
    expect(route.km).toBeGreaterThanOrEqual(request.minKm - 1e-6);
    expect(route.km).toBeLessThanOrEqual(request.maxKm + 1e-6);
  }
  expect(avoiding[0].intensity.motorcar.weightedKm / avoiding[0].km).toBeLessThan(neutral[0].intensity.motorcar.weightedKm / neutral[0].km);
});

test("street baseline, dirt access split, and unknown are independent of legal access", () => {
  expect(describeVehicleIntensity({ highway: "residential" })).toMatchObject({ motorcar: 1, motorcycle: 1 });
  expect(describeVehicleIntensity({ highway: "primary" })).toMatchObject({ motorcar: 1.5, motorcycle: 1.5 });
  expect(describeVehicleIntensity({ highway: "track", surface: "dirt", motor_vehicle: "no" })).toMatchObject({ motorcar: 0, motorcycle: 0 });
  expect(describeVehicleIntensity({ highway: "track", surface: "dirt", motorcar: "no", motorcycle: "yes" })).toMatchObject({ motorcar: 0, motorcycle: 1 });
  expect(describeVehicleIntensity({ highway: "track" })).toMatchObject({ motorcar: null, motorcycle: null });
  expect(describeVehicleIntensity({ highway: "footway", footway: "sidewalk", motor_vehicle: "no" })).toMatchObject({ motorcar: null, motorcycle: null });
  const neutral = { motorcar: 0, motorcycle: 0, bicycle: 0 };
  const dirt = { highway: "track", surface: "dirt", motorcar: "no", motorcycle: "yes" };
  const zero = { highway: "track", surface: "dirt", motor_vehicle: "no" };
  const example = Schema.decodeUnknownSync(Region)({ ...region,
    ways: [{ id: "1", tags: dirt }, { id: "2", tags: zero }],
    edges: [{ a: 0, b: 1, way: 0, meters: 1000 }, { a: 1, b: 2, way: 1, meters: 1000 }],
  });
  const motorcycle = analyze(example, [0], [0, 1], "moto");
  const motorFree = analyze(example, [1], [1, 2], "free");
  expect(preferencePenalty(motorcycle, { ...neutral, motorcar: -5 })).toBe(preferencePenalty(motorFree, { ...neutral, motorcar: -5 }));
  expect(preferencePenalty(motorcycle, { ...neutral, motorcycle: -5 })).toBeGreaterThan(preferencePenalty(motorFree, { ...neutral, motorcycle: -5 }));
  expect(preferencePenalty(motorcycle, { ...neutral, motorcycle: 5 })).toBeLessThan(preferencePenalty(motorFree, { ...neutral, motorcycle: 5 }));
});

test("parallel adjacent sidewalk inherits discounted road traffic, isolated or crossing footway does not", () => {
  const small = Schema.decodeUnknownSync(Region)({ ...region,
    nodes: [
      [39, -120], [39, -119.999], [39.00006, -120], [39.00006, -119.999],
      [39.001, -120], [39.001, -119.999], [38.9995, -119.9995], [39.0005, -119.9995],
    ].map(([lat, lon], i) => ({ id: String(i), lat, lon, tags: {} })),
    ways: [{ id: "1", tags: { highway: "residential" } }, { id: "2", tags: { highway: "footway", footway: "sidewalk", motor_vehicle: "no" } }],
    edges: [{ a: 0, b: 1, way: 0, meters: 86 }, { a: 2, b: 3, way: 1, meters: 86 }, { a: 4, b: 5, way: 1, meters: 86 }, { a: 6, b: 7, way: 1, meters: 111 }],
  });
  const values = regionVehicleIntensity(small);
  expect(values[1]).toMatchObject({ motorcar: 0.8, motorcycle: 0.8, basis: "sidewalk" });
  expect(values[2].motorcar).toBeNull();
  expect(values[3].motorcar).toBeNull();
  const route = analyze(small, [1, 1], [2, 3, 2], "sidewalk");
  expect(route.intensity.motorcar.weightedKm).toBeCloseTo(0.8 * route.km);
  expect(route.intensity.motorcar.sidewalkKm).toBeCloseTo(route.km);
  expect(route.exposure.motorcar.prohibited).toBeCloseTo(route.km);
  const isolated = analyze(small, [2, 2], [4, 5, 4], "isolated");
  const avoiding = { motorcar: -5, motorcycle: 0, bicycle: 0 };
  expect(preferencePenalty(route, avoiding)).toBeGreaterThan(preferencePenalty(isolated, avoiding));
});
