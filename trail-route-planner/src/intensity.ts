import type { Region } from "./domain";

export type Vehicle = "motorcar" | "motorcycle";
export interface VehicleIntensity { motorcar: number | null; motorcycle: number | null; basis: "street" | "trail" | "sidewalk" | "unknown" }

const major = new Set(["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified"]);
const streets = new Set(["residential", "living_street", "service", ...major]);
const paths = new Set(["path", "footway", "cycleway", "bridleway", "steps", "pedestrian"]);
const forbidden = new Set(["no", "private"]);
const allowed = new Set(["yes", "designated", "official", "permissive"]);

// Traffic exposure is not legal access: a motor-prohibited sidewalk beside a street
// still experiences that street's vehicles. null means no defensible estimate, not zero.
export function describeVehicleIntensity(tags: Record<string, string>, adjacentRoad?: VehicleIntensity): VehicleIntensity {
  if (tags.highway === "footway" && tags.footway !== "crossing" && adjacentRoad) {
    return { motorcar: adjacentRoad.motorcar === null ? null : adjacentRoad.motorcar * 0.8,
      motorcycle: adjacentRoad.motorcycle === null ? null : adjacentRoad.motorcycle * 0.8, basis: "sidewalk" }
  }
  if (tags.highway === "footway" && tags.footway === "sidewalk") {
    return { motorcar: null, motorcycle: null, basis: "unknown" };
  }
  if (streets.has(tags.highway)) {
    const value = major.has(tags.highway) ? 1.5 : 1;
    return { motorcar: value, motorcycle: value, basis: "street" };
  }
  const motor = tags.motor_vehicle ?? tags.vehicle ?? tags.access;
  const car = tags.motorcar ?? motor;
  const motorcycle = tags.motorcycle ?? motor;
  const estimate = (value: string | undefined, vehicle: Vehicle): number | null =>
    value && forbidden.has(value) ? 0 : value && allowed.has(value) ? 1
      : paths.has(tags.highway) && vehicle === "motorcar" ? 0 : null;
  const motorcar = estimate(car, "motorcar"), moto = estimate(motorcycle, "motorcycle");
  return { motorcar, motorcycle: moto, basis: motorcar !== null || moto !== null ? "trail" : "unknown" };
}

const cache = new WeakMap<Region, VehicleIntensity[]>();
export function regionVehicleIntensity(region: Region): VehicleIntensity[] {
  const cached = cache.get(region);
  if (cached) return cached;
  const result = region.edges.map(e => describeVehicleIntensity(region.ways[e.way].tags));
  const lonScale = 111320 * Math.cos(region.nodes[0]?.lat * Math.PI / 180 || 0.7);
  const point = (n: number) => ({ x: region.nodes[n].lon * lonScale, y: region.nodes[n].lat * 111320 });
  const cell = (x: number) => Math.floor(x / 30);
  const grid = new Map<string, number[]>();
  region.edges.forEach((e, i) => {
    if (!streets.has(region.ways[e.way].tags.highway)) return;
    const a = point(e.a), b = point(e.b);
    for (let x = cell(Math.min(a.x, b.x) - 20); x <= cell(Math.max(a.x, b.x) + 20); x++)
      for (let y = cell(Math.min(a.y, b.y) - 20); y <= cell(Math.max(a.y, b.y) + 20); y++) {
        const key = `${x},${y}`, bucket = grid.get(key) ?? [];
        bucket.push(i); grid.set(key, bucket);
      }
  });
  region.edges.forEach((e, i) => {
    const tags = region.ways[e.way].tags;
    if (tags.highway !== "footway" || tags.footway === "crossing") return;
    const a = point(e.a), b = point(e.b), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    let nearest = 20, road: VehicleIntensity | undefined;
    for (const j of grid.get(`${cell(mx)},${cell(my)}`) ?? []) {
      const other = region.edges[j], c = point(other.a), d = point(other.b);
      const vx = d.x - c.x, vy = d.y - c.y, length2 = vx * vx + vy * vy;
      if (!length || !length2 || Math.abs(dx * vx + dy * vy) / (length * Math.sqrt(length2)) < 0.8) continue;
      const t = Math.max(0, Math.min(1, ((mx - c.x) * vx + (my - c.y) * vy) / length2));
      const separation = Math.hypot(mx - c.x - t * vx, my - c.y - t * vy);
      if (separation < nearest) { nearest = separation; road = result[j]; }
    }
    result[i] = describeVehicleIntensity(tags, road);
  });
  cache.set(region, result);
  return result;
}
