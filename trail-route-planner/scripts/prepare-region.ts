import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Fixed, modest Kings Beach / Stateline box. Overpass output includes all way nodes.
export const bounds = [39.202, -120.075, 39.255, -120.005] as const;
export const query = `[out:json][timeout:80];(way[highway~"^(path|footway|track|cycleway|bridleway|steps|residential|service|unclassified|tertiary)$"](${bounds.join(",")}););out body;>;out skel qt;`;
export const endpoint = "https://overpass.kumi.systems/api/interpreter";

if (import.meta.main) {
  const input = process.argv[2];
  const bytes = input ? await readFile(resolve(input)) : Buffer.from(await (async () => {
    const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
    return response.arrayBuffer();
  })());
  const raw = JSON.parse(bytes.toString()) as {
    osm3s: { timestamp_osm_base: string }; elements: Array<{
      type: string; id: number; lat?: number; lon?: number; nodes?: number[]; tags?: Record<string, string>;
    }>;
  };
  if (!raw.osm3s?.timestamp_osm_base || !raw.elements?.length) throw new Error("Missing OSM source metadata/elements");
  const nodes = new Map(raw.elements.filter(e => e.type === "node").map(e => [e.id, e]));
  const nodeList: Array<{ id: string; lat: number; lon: number; tags: Record<string, string> }> = [];
  const nodeIndex = new Map<number, number>();
  const ways: Array<{ id: string; tags: Record<string, string> }> = [];
  const edges: Array<{ a: number; b: number; way: number; meters: number }> = [];
  const rad = Math.PI / 180;
  const length = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
    const dy = (b.lat - a.lat) * rad;
    const dx = (b.lon - a.lon) * rad;
    const h = Math.sin(dy / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dx / 2) ** 2;
    return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)) * 10) / 10;
  };
  const index = (id: number) => {
    const existing = nodeIndex.get(id);
    if (existing !== undefined) return existing;
    const node = nodes.get(id);
    if (node?.lat === undefined || node.lon === undefined) throw new Error(`Unresolved OSM node ${id}`);
    const next = nodeList.length;
    nodeList.push({ id: String(id), lat: node.lat, lon: node.lon, tags: node.tags ?? {} });
    nodeIndex.set(id, next);
    return next;
  };
  for (const way of raw.elements.filter(e => e.type === "way")) {
    if (!way.nodes || way.nodes.length < 2) continue;
    const wi = ways.length;
    ways.push({ id: String(way.id), tags: way.tags ?? {} });
    for (let i = 1; i < way.nodes.length; i++) {
      const a = index(way.nodes[i - 1]);
      const b = index(way.nodes[i]);
      if (a !== b) edges.push({ a, b, way: wi, meters: length(nodeList[a], nodeList[b]) });
    }
  }
  const region = {
    format: 1, id: "kings-beach-v0", bounds, source: {
      name: "OpenStreetMap contributors via Overpass API", url: endpoint, query,
      osmBaseTimestamp: raw.osm3s.timestamp_osm_base, sha256: createHash("sha256").update(bytes).digest("hex"),
      license: "ODbL 1.0 · https://www.openstreetmap.org/copyright",
    }, nodes: nodeList, ways, edges,
  };
  await mkdir("public", { recursive: true });
  await writeFile("public/kings-beach.json", JSON.stringify(region));
  console.log(`Prepared ${nodeList.length} nodes, ${ways.length} ways, ${edges.length} edges (${(JSON.stringify(region).length / 1024).toFixed(0)} KiB).`);
}
