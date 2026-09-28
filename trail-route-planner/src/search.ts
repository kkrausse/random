import { analyze, interpret, type Region, type Route, type SearchPreferences, type SearchRequest } from "./domain";
import { regionVehicleIntensity, type VehicleIntensity } from "./intensity";

const accessTypes = ["motorcar", "motorcycle", "bicycle"] as const;
const distanceToleranceKm = 1e-6;
export const NEUTRAL_SEARCH_PREFERENCES: SearchPreferences = { motorcar: 0, motorcycle: 0, bicycle: 0 };
export const DEFAULT_SEARCH_PREFERENCES: SearchPreferences = { ...NEUTRAL_SEARCH_PREFERENCES };

// These are fixed discovery strategies, not the user's sliders. Always search
// neutral distances too: a traffic-avoiding detour may exceed the hard range.
const discoveryProfiles: SearchPreferences[] = [
  NEUTRAL_SEARCH_PREFERENCES,
  { ...NEUTRAL_SEARCH_PREFERENCES, motorcar: -5 },
  { ...NEUTRAL_SEARCH_PREFERENCES, motorcycle: -5 },
  { ...NEUTRAL_SEARCH_PREFERENCES, bicycle: 5 },
];

// Unknown is deliberately neither free of traffic nor the same as a measured zero.
const estimated = (value: number | null) => value ?? 0.75;
function vehicleBias(intensity: VehicleIntensity, preferences: SearchPreferences): number {
  return (["motorcar", "motorcycle"] as const).reduce((sum, key) => {
    const preference = preferences[key];
    return sum + (preference < 0 ? -preference * estimated(intensity[key]) : preference * (1.5 - estimated(intensity[key]))) * 0.8;
  }, 0);
}

export function preferencePenalty(route: Route, preferences: SearchPreferences): number {
  return accessTypes.reduce((sum, type) => {
    const preference = preferences[type];
    const permitted = route.exposure[type].permitted;
    if (type !== "bicycle") {
      const traffic = route.intensity[type];
      const total = traffic.weightedKm + 0.75 * traffic.unknownKm;
      return sum + 0.8 * (preference < 0 ? -preference * total : preference * (1.5 * route.km - total));
    }
    return sum + 0.8 * Math.abs(preference) * (preference > 0 ? route.km - permitted : preference < 0 ? permitted : 0);
  }, 0);
}

interface Step { edge: number; to: number }
export function adjacency(region: Region): Step[][] {
  const adj: Step[][] = Array.from({ length: region.nodes.length }, () => []);
  region.edges.forEach((e, i) => {
    // The imported oneway tag normally governs motor vehicles, not walking or
    // gravel riding. It must not disconnect otherwise connected road routes.
    adj[e.a].push({ edge: i, to: e.b });
    adj[e.b].push({ edge: i, to: e.a });
  });
  return adj;
}

// Lightweight binary heap: complete shortest-path searches stay bounded by region size.
function shortest(region: Region, adj: Step[][], intensities: VehicleIntensity[], start: number, goal: number, mode: SearchRequest["mode"], preferences: SearchPreferences, penalty: Set<number>) {
  const distance = new Float64Array(region.nodes.length).fill(Infinity);
  const parent = new Int32Array(region.nodes.length).fill(-1);
  const via = new Int32Array(region.nodes.length).fill(-1);
  const heap: Array<[number, number]> = [[0, start]];
  distance[start] = 0;
  const push = (entry: [number, number]) => { let i = heap.length; heap.push(entry); while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= entry[0]) break; heap[i] = heap[p]; i = p; } heap[i] = entry; };
  const pop = (): [number, number] => { const first = heap[0]; const last = heap.pop()!; if (heap.length) { let i = 0; while (i * 2 + 1 < heap.length) { let child = i * 2 + 1; if (child + 1 < heap.length && heap[child + 1][0] < heap[child][0]) child++; if (heap[child][0] >= last[0]) break; heap[i] = heap[child]; i = child; } heap[i] = last; } return first; };
  while (heap.length) {
    const [cost, node] = pop();
    if (cost !== distance[node]) continue;
    if (node === goal) break;
    for (const step of adj[node]) {
      const e = region.edges[step.edge], tags = region.ways[e.way].tags;
      // OSM access tags (including foot/bicycle=no, private roads, and node
      // barriers) are incomplete evidence, not a routing exclusion. Otherwise
      // a connected car-road-only region can yield no routes at any slider.
      // Keep only the physical activity constraint for riding on steps.
      if (mode === "gravel" && tags.highway === "steps") continue;
      const accessBias = vehicleBias(intensities[step.edge], preferences)
        + (preferences.bicycle && interpret(tags, "bicycle").access === "permitted" ? -0.12 * preferences.bicycle : 0);
      const modifier = Math.max(0.2, 1 + accessBias + (penalty.has(step.edge) ? 2.5 : 0));
      const next = cost + e.meters * modifier;
      if (next < distance[step.to]) { distance[step.to] = next; parent[step.to] = node; via[step.to] = step.edge; push([next, step.to]); }
    }
  }
  if (!Number.isFinite(distance[goal])) return null;
  const nodes = [goal], edges: number[] = [];
  for (let at = goal; at !== start; at = parent[at]) { if (parent[at] < 0) return null; edges.push(via[at]); nodes.push(parent[at]); }
  return { nodes: nodes.reverse(), edges: edges.reverse() };
}

export function generate(region: Region, request: SearchRequest, cancelled: () => boolean = () => false): Route[] {
  const adj = adjacency(region);
  const intensities = regionVehicleIntensity(region);
  const start = request.start;
  if (!adj[start]?.length) return [];
  const targets: Array<[number, number]> = [];
  const origin = region.nodes[start];
  for (let n = 0; n < region.nodes.length; n++) {
    if (!adj[n].length || n === start) continue;
    const p = region.nodes[n];
    const air = Math.hypot((p.lat - origin.lat) * 111000, (p.lon - origin.lon) * 86000);
    if (air > request.minKm * 1000 * 0.12 && air < request.maxKm * 1000 * 0.57) targets.push([n, air]);
  }
  // Sampling and every subsequent membership decision are slider-independent.
  const targetCount = 110;
  const selected = targets.filter(([n]) => {
    const residue = n % 11, seed = Math.abs(request.seed) % 11;
    return residue === seed || residue === (seed + 1) % 11;
  }).sort((a, b) => a[1] - b[1]);
  const sampled = selected.filter((_, i) => i % Math.max(1, Math.floor(selected.length / targetCount)) === 0).slice(0, targetCount);
  const candidates: Route[] = [], seen = new Set<string>();
  candidateSearch: for (const [target] of sampled) for (let profile = 0; profile < discoveryProfiles.length; profile++) {
    if (cancelled()) break candidateSearch;
    const discovery = discoveryProfiles[profile];
    const outward = shortest(region, adj, intensities, start, target, request.mode, discovery, new Set());
    if (!outward) continue;
    const inbound = request.shape === "loop"
      ? shortest(region, adj, intensities, target, start, request.mode, discovery, new Set(outward.edges))
      : { nodes: [...outward.nodes].reverse(), edges: [...outward.edges].reverse() };
    if (!inbound) continue;
    const edges = [...outward.edges, ...inbound.edges];
    const nodes = [...outward.nodes, ...inbound.nodes.slice(1)];
    const signature = [...new Set(edges)].sort((a, b) => a - b).join(",");
    if (seen.has(signature)) continue;
    seen.add(signature);
    const route = analyze(region, edges, nodes, `${request.shape}-${target}-${profile}`);
    const middle = (request.minKm + request.maxKm) / 2;
    route.score = Math.abs(route.km - middle) + (request.shape === "loop" ? (route.km - route.uniqueKm) * 0.9 : 0);
    if (route.km >= request.minKm - distanceToleranceKm && route.km <= request.maxKm + distanceToleranceKm) candidates.push(route);
  }
  candidates.sort((a, b) => a.score - b.score);
  const chosen: Route[] = [];
  for (const candidate of candidates) {
    const set = new Set(candidate.edges);
    if (chosen.some(other => {
      const shared = [...new Set(other.edges)].reduce((sum, e) => sum + (set.has(e) ? region.edges[e].meters : 0), 0) / 1000;
      return shared / Math.min(candidate.uniqueKm, other.uniqueKm) > 0.82;
    })) continue;
    chosen.push(candidate);
    if (chosen.length === 24) break;
  }
  for (const route of chosen) route.score += preferencePenalty(route, request.preferences);
  return chosen.sort((a, b) => a.score - b.score);
}
