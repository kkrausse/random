import { Schema } from "effect";

export const RegionId = Schema.String.check(Schema.isMinLength(1)).pipe(Schema.brand("RegionId"));
export const OsmWayId = Schema.String.check(Schema.isPattern(/^\d+$/)).pipe(Schema.brand("OsmWayId"));
export const Meters = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand("Meters"));
export const Node = Schema.Struct({ id: Schema.String, lat: Schema.Number, lon: Schema.Number, tags: Schema.Record(Schema.String, Schema.String) });
export interface Node extends Schema.Schema.Type<typeof Node> {}
export const Way = Schema.Struct({ id: OsmWayId, tags: Schema.Record(Schema.String, Schema.String) });
export interface Way extends Schema.Schema.Type<typeof Way> {}
export const Edge = Schema.Struct({ a: Schema.Number, b: Schema.Number, way: Schema.Number, meters: Meters });
export interface Edge extends Schema.Schema.Type<typeof Edge> {}
export const Region = Schema.Struct({
  format: Schema.Literal(1), id: RegionId, bounds: Schema.Tuple([Schema.Number, Schema.Number, Schema.Number, Schema.Number]),
  source: Schema.Struct({ name: Schema.String, url: Schema.String, query: Schema.String, osmBaseTimestamp: Schema.String, sha256: Schema.String, license: Schema.String }),
  nodes: Schema.Array(Node), ways: Schema.Array(Way), edges: Schema.Array(Edge),
});
export interface Region extends Schema.Schema.Type<typeof Region> {}
export const AccessPreference = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(-5), Schema.isLessThanOrEqualTo(5));
export const SearchPreferences = Schema.Struct({ motorcar: AccessPreference, motorcycle: AccessPreference, bicycle: AccessPreference });
export interface SearchPreferences extends Schema.Schema.Type<typeof SearchPreferences> {}
export const SearchRequest = Schema.Struct({ start: Schema.Number, minKm: Schema.Number, maxKm: Schema.Number, shape: Schema.Literals(["loop", "out-and-back"]), mode: Schema.Literals(["hike", "gravel"]), seed: Schema.Number, preferences: SearchPreferences });
export interface SearchRequest extends Schema.Schema.Type<typeof SearchRequest> {}

export type Access = "permitted" | "prohibited" | "restricted" | "unknown";
export interface Evidence { access: Access; basis: "explicit" | "inferred" | "unknown"; tag?: string; value?: string }

export function interpret(tags: Record<string, string>, attribute: "motorcycle" | "motorcar" | "bicycle" | "foot" | "motor_vehicle"): Evidence {
  const keys: Record<typeof attribute, string[]> = {
    motorcycle: ["motorcycle", "motor_vehicle", "vehicle", "access"],
    motorcar: ["motorcar", "motor_vehicle", "vehicle", "access"],
    bicycle: ["bicycle", "vehicle", "access"], foot: ["foot", "access"],
    motor_vehicle: ["motor_vehicle", "vehicle", "access"],
  };
  for (const key of keys[attribute]) {
    const value = tags[key];
    if (!value) continue;
    const access: Access = ["yes", "designated", "official", "permissive"].includes(value) ? "permitted"
      : ["no", "private"].includes(value) ? "prohibited" : "restricted";
    return { access, basis: "explicit", tag: key, value };
  }
  if (attribute === "foot" && ["footway", "steps"].includes(tags.highway)) return { access: "permitted", basis: "inferred", tag: "highway", value: tags.highway };
  if (attribute === "bicycle" && tags.highway === "cycleway") return { access: "permitted", basis: "inferred", tag: "highway", value: tags.highway };
  // Classification does not establish verified prohibition of other users.
  return { access: "unknown", basis: "unknown" };
}

export interface Route {
  id: string; edges: number[]; nodes: number[]; km: number; uniqueKm: number; score: number;
  exposure: Record<"motorcar" | "motorcycle" | "bicycle", Record<Access, number>>;
  evidence: Record<"motorcar" | "motorcycle" | "bicycle", Record<"explicit" | "inferred" | "unknown", number>>;
  trailKm: number; roadKm: number;
}

export function analyze(region: Region, edges: number[], nodes: number[], id: string, score = 0): Route {
  const exposure = Object.fromEntries(["motorcar", "motorcycle", "bicycle"].map(k => [k, { permitted: 0, prohibited: 0, restricted: 0, unknown: 0 }])) as Route["exposure"];
  const evidence = Object.fromEntries(["motorcar", "motorcycle", "bicycle"].map(k => [k, { explicit: 0, inferred: 0, unknown: 0 }])) as Route["evidence"];
  let meters = 0, trail = 0, road = 0;
  for (const edgeId of edges) {
    const edge = region.edges[edgeId];
    const tags = region.ways[edge.way].tags;
    meters += edge.meters;
    if (["path", "footway", "track", "cycleway", "bridleway", "steps"].includes(tags.highway)) trail += edge.meters;
    else road += edge.meters;
    for (const key of ["motorcar", "motorcycle", "bicycle"] as const) {
      const e = interpret(tags, key);
      exposure[key][e.access] += edge.meters;
      evidence[key][e.basis] += edge.meters;
    }
  }
  return { id, edges, nodes, km: meters / 1000, uniqueKm: [...new Set(edges)].reduce((sum, e) => sum + region.edges[e].meters, 0) / 1000,
    score, exposure: Object.fromEntries(Object.entries(exposure).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([s, m]) => [s, m / 1000]))])) as Route["exposure"],
    evidence: Object.fromEntries(Object.entries(evidence).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([s, m]) => [s, m / 1000]))])) as Route["evidence"],
    trailKm: trail / 1000, roadKm: road / 1000 };
}
