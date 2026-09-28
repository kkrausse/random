import { analyze, interpret, type Region, type Route, type SearchRequest } from "./domain";

interface Step { edge: number; to: number }
export function adjacency(region: Region): Step[][] {
  const adj: Step[][] = Array.from({ length: region.nodes.length }, () => []);
  region.edges.forEach((e, i) => {
    const tags = region.ways[e.way].tags;
    if (tags.oneway !== "-1") adj[e.a].push({ edge: i, to: e.b });
    if (tags.oneway !== "yes" && tags.oneway !== "1") adj[e.b].push({ edge: i, to: e.a });
  });
  return adj;
}

// Lightweight binary heap: complete shortest-path searches stay bounded by region size.
function shortest(region: Region, adj: Step[][], start: number, goal: number, mode: SearchRequest["mode"], penalty: Set<number>, variation: number) {
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
      const own = interpret(tags, mode === "hike" ? "foot" : "bicycle");
      if (own.access === "prohibited" || own.access === "restricted" || (mode === "gravel" && tags.highway === "steps")) continue;
      if (region.nodes[step.to].tags.barrier && ["gate", "lift_gate", "stile"].includes(region.nodes[step.to].tags.barrier) === false) continue;
      const motor = interpret(tags, "motor_vehicle");
      const road = ["residential", "service", "tertiary", "unclassified"].includes(tags.highway);
      const modifier = 1 + (road ? 0.4 + variation * 0.3 : 0) + (motor.access === "permitted" ? 0.15 : 0) + (penalty.has(step.edge) ? 2.5 : 0);
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
  // Deterministic spread across distance and bearing; cap searches independent of node count.
  const selected = targets.filter(([n]) => n % 11 === Math.abs(request.seed) % 11).sort((a, b) => a[1] - b[1]);
  const sampled = selected.filter((_, i) => i % Math.max(1, Math.floor(selected.length / 110)) === 0).slice(0, 110);
  const candidates: Route[] = [], seen = new Set<string>();
  for (const [target] of sampled) {
    if (cancelled()) break;
    const outward = shortest(region, adj, start, target, request.mode, new Set(), target % 3);
    if (!outward) continue;
    const inbound = request.shape === "loop"
      ? shortest(region, adj, target, start, request.mode, new Set(outward.edges), (target + 1) % 3)
      : { nodes: [...outward.nodes].reverse(), edges: [...outward.edges].reverse() };
    if (!inbound) continue;
    const edges = [...outward.edges, ...inbound.edges];
    const nodes = [...outward.nodes, ...inbound.nodes.slice(1)];
    const signature = [...new Set(edges)].sort((a, b) => a - b).join(",");
    if (seen.has(signature)) continue;
    seen.add(signature);
    const route = analyze(region, edges, nodes, `${request.shape}-${target}`);
    const middle = (request.minKm + request.maxKm) / 2;
    route.score = Math.abs(route.km - middle) + route.roadKm * 0.55 + (request.shape === "loop" ? (route.km - route.uniqueKm) * 0.9 : 0);
    if (route.km >= request.minKm * 0.55 && route.km <= request.maxKm * 1.5) candidates.push(route);
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
  return chosen;
}
