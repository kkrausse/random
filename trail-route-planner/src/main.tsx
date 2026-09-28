import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Effect } from "effect";
import { ArrowDownUp, Footprints, Mountain, RotateCcw, Search } from "lucide-react";
import { Select } from "@base-ui/react/select";
import { RegionStore, regionLayer } from "./services";
import { interpret, type Region, type Route, type SearchRequest } from "./domain";
import { adjacency } from "./search";
import { RouteMap, type MapAccessMode } from "./route-map";
import { displayDistance, inputDistance, toKilometers, type DistanceUnit } from "./units";
import "./style.css";

const attrs = ["highway", "surface", "tracktype", "smoothness", "width", "incline", "sac_scale", "mtb:scale", "access", "foot", "bicycle", "electric_bicycle", "motor_vehicle", "motorcar", "motorcycle", "horse", "oneway"];
function App() {
  const [region, setRegion] = useState<Region>();
  const [error, setError] = useState("");
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selected, setSelected] = useState(0);
  const [edge, setEdge] = useState<number>();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [sort, setSort] = useState<"score" | "distance" | "motorcycle" | "road">("score");
  const [mode, setMode] = useState<SearchRequest["mode"]>("hike");
  const [accessMode, setAccessMode] = useState<MapAccessMode>("motorcycle");
  const [shape, setShape] = useState<SearchRequest["shape"]>("loop");
  const [units, setUnits] = useState<DistanceUnit>(() => localStorage.getItem("trail-distance-unit") === "km" ? "km" : "mi");
  const [min, setMin] = useState(toKilometers(2, "mi")), [max, setMax] = useState(toKilometers(6, "mi"));
  const [start, setStart] = useState(0);
  const [busy, setBusy] = useState(false);
  const worker = useRef<Worker | undefined>(undefined);
  useEffect(() => { localStorage.setItem("trail-distance-unit", units); }, [units]);
  useEffect(() => {
    const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    w.onmessage = e => {
      if (e.data.type === "results") { setRoutes(e.data.routes); setSelected(0); setBusy(false); }
      if (e.data.type === "error") { setError(e.data.message); setBusy(false); }
    };
    Effect.runPromise(Effect.gen(function* () { return yield* (yield* RegionStore).load(); }).pipe(Effect.provide(regionLayer)))
      .then(data => {
        setRegion(data);
        const target = { lat: 39.239, lon: -120.035 };
        const adjacent = adjacency(data);
        const visited = new Set<number>(); let largest = new Set<number>();
        for (let n = 0; n < adjacent.length; n++) {
          if (visited.has(n)) continue;
          const component = [n]; visited.add(n);
          for (let i = 0; i < component.length; i++) for (const link of adjacent[component[i]]) if (!visited.has(link.to)) { visited.add(link.to); component.push(link.to); }
          if (component.length > largest.size) largest = new Set(component);
        }
        let best = 0, distance = Infinity;
        data.edges.forEach(e => {
          if (!["path", "footway", "track"].includes(data.ways[e.way].tags.highway)) return;
          for (const n of [e.a, e.b]) { if (!largest.has(n)) continue; const p = data.nodes[n], d = Math.hypot((p.lat - target.lat) * 111, (p.lon - target.lon) * 86); if (d < distance) { best = n; distance = d; } }
        });
        setStart(best);
      }).catch(e => setError(String(e)));
    return () => w.terminate();
  }, []);
  useEffect(() => {
    if (!region || !worker.current) return;
    setBusy(true); setRoutes([]);
    // Replace the worker to interrupt obsolete CPU work rather than queueing stale searches.
    worker.current.terminate();
    const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }); worker.current = w;
    w.onmessage = e => { if (e.data.type === "results") { setRoutes(e.data.routes); setSelected(0); setBusy(false); } if (e.data.type === "error") { setError(e.data.message); setBusy(false); } };
    w.postMessage({ type: "load", region });
    w.postMessage({ type: "search", request: { start, minKm: min, maxKm: max, mode, shape, seed: 3 } });
  }, [region, start, min, max, mode, shape]);
  const ordered = useMemo(() => [...routes].sort((a, b) => sort === "distance" ? a.km - b.km : sort === "motorcycle" ? a.exposure.motorcycle.permitted - b.exposure.motorcycle.permitted : sort === "road" ? a.roadKm - b.roadKm : a.score - b.score), [routes, sort]);
  const route = ordered[selected];
  const inspected = edge === undefined || !region ? undefined : region.edges[edge];
  const tags = inspected ? region!.ways[inspected.way].tags : undefined;
  const accessEvidence = tags ? interpret(tags, accessMode) : undefined;
  const distance = (value: number) => displayDistance(value, units);
  return <div className="app">
    <header><div className="brand"><Mountain size={24}/><div><strong>Trail Routes</strong><span>KINGS BEACH · NORTH LAKE TAHOE</span></div></div><div className="status">{region ? `${region.ways.length.toLocaleString()} OSM ways · ${region.edges.length.toLocaleString()} edges` : "Loading region…"}<span className="dot"/> Offline-ready</div></header>
    <main><aside className="sidebar"><div className="intro"><div className="eyebrow">LOCAL ROUTE EXPLORER / V0</div><h1>Find your way<br/><em>out there.</em></h1><p>Routes generated on your device from real OpenStreetMap trails. Click the map to move the start.</p></div>
      <section className="controls"><div className="section-title"><Search size={16}/> SEARCH PARAMETERS</div><label>ACTIVITY</label><div className="segmented"><button className={mode === "hike" ? "active" : ""} onClick={() => setMode("hike")}><Footprints size={15}/> Hiking</button><button className={mode === "gravel" ? "active" : ""} onClick={() => setMode("gravel")}>Gravel bike</button></div><label>ROUTE SHAPE</label><div className="segmented"><button className={shape === "loop" ? "active" : ""} onClick={() => setShape("loop")}><RotateCcw size={15}/> Loop</button><button className={shape === "out-and-back" ? "active" : ""} onClick={() => setShape("out-and-back")}>Out & back</button></div><div className="unit-row"><label htmlFor="min">DISTANCE RANGE · {units.toUpperCase()}</label><div className="unit-switch" role="group" aria-label="Distance units"><button aria-pressed={units === "mi"} onClick={() => setUnits("mi")}>mi</button><button aria-pressed={units === "km"} onClick={() => setUnits("km")}>km</button></div></div><div className="range"><input id="min" type="number" min="0.5" step="0.1" max={inputDistance(max, units)} value={inputDistance(min, units)} onChange={e => setMin(toKilometers(Number(e.target.value), units))}/><span>to</span><input aria-label="Maximum distance" type="number" min={inputDistance(min, units)} step="0.1" value={inputDistance(max, units)} onChange={e => setMax(toKilometers(Number(e.target.value), units))}/></div></section>
      <section className="results"><div className="results-title"><div><div className="eyebrow">EXPLORE OPTIONS</div><h2>{busy ? "Searching…" : `${routes.length} routes found`}</h2></div><Select.Root value={sort} onValueChange={v => setSort(v as typeof sort)}><Select.Trigger className="sort"><ArrowDownUp size={14}/><Select.Value/></Select.Trigger><Select.Portal><Select.Positioner><Select.Popup className="sort-menu">{(["score", "distance", "motorcycle", "road"] as const).map(s => <Select.Item key={s} value={s} className="sort-item">{s}</Select.Item>)}</Select.Popup></Select.Positioner></Select.Portal></Select.Root></div>
         <div className="table-wrap"><table><thead><tr><th>#</th><th>{units.toUpperCase()}</th><th>TRAIL</th><th>ROAD</th><th>MOTO +</th><th>MOTO ?</th></tr></thead><tbody>{ordered.map((r, i) => <tr key={r.id} className={selected === i ? "chosen" : ""} onClick={() => { setSelected(i); setEdge(undefined); }}><td>{String(i + 1).padStart(2, "0")}</td><td>{distance(r.km)}</td><td>{distance(r.trailKm)}</td><td>{distance(r.roadKm)}</td><td>{distance(r.exposure.motorcycle.permitted)}</td><td>{distance(r.exposure.motorcycle.unknown)}</td></tr>)}</tbody></table></div>
         <div className="table-note">All distances in {units}. Repeated travel counts; + explicit permission; ? unresolved. Columns overlap other access categories.</div></section>
    </aside><section className="map-panel"><div className="map-top"><span><span className="map-marker"/> KINGS BEACH / STATELINE</span><span>ONLINE BASEMAP · LOCAL OSM ROUTES · {region?.source.osmBaseTimestamp.slice(0, 10) ?? "…"}</span></div>
       {region && <div className="map"><RouteMap region={region} route={route} start={start} inspectedEdge={edge} accessMode={accessMode} onAccessModeChange={setAccessMode} units={units} onStartChange={setStart} onInspect={setEdge}/></div>}
      <div className="map-hint">DRAG TO PAN · ⌘/CTRL + SCROLL OR +/− TO ZOOM · CLICK TO SET START</div>
       {route && <div className={`detail${detailsOpen ? " expanded" : ""}`}><div className="eyebrow">SELECTED ROUTE / {String(selected + 1).padStart(2, "0")}</div><button className="detail-toggle" onClick={() => setDetailsOpen(!detailsOpen)} aria-expanded={detailsOpen}>{detailsOpen ? "Less detail" : "Access detail"}</button><h2>{distance(route.km)} {units} <small>{shape}</small></h2><div className="stats"><div><b>{distance(route.uniqueKm)}</b><span>UNIQUE {units.toUpperCase()}</span></div><div><b>{distance(route.trailKm)}</b><span>TRAIL {units.toUpperCase()}</span></div><div><b>{distance(route.roadKm)}</b><span>ROAD {units.toUpperCase()}</span></div></div><div className="evidence"><strong>ACCESS EVIDENCE · {units} traveled</strong>{(["motorcycle", "bicycle", "motor_vehicle"] as const).map(k => <div key={k}><span>{k.replace("_", " ")}</span><span>+ {distance(route.exposure[k].permitted)} · − {distance(route.exposure[k].prohibited)} · ~ {distance(route.exposure[k].restricted)} · ? {distance(route.exposure[k].unknown)}</span></div>)}<small>+ permitted, − prohibited, ~ conditional/restricted, ? unknown. Explicit / inferred / unknown motorcycle: {distance(route.evidence.motorcycle.explicit)} / {distance(route.evidence.motorcycle.inferred)} / {distance(route.evidence.motorcycle.unknown)} {units}. No observed traffic or physical-separation evidence is inferred.</small></div></div>}
       {tags && inspected && accessEvidence && <div className="inspect"><button className="close" onClick={() => setEdge(undefined)}>×</button><div className="eyebrow">SOURCE SEGMENT · OSM WAY {region!.ways[inspected.way].id}</div><h3>{tags.name || tags.highway || "Unnamed way"}</h3><p>{distance(inspected.meters / 1000)} {units} · {accessMode === "motorcar" ? "car" : accessMode}: {accessEvidence.access} ({accessEvidence.tag ? `${accessEvidence.tag}=${accessEvidence.value}` : "no applicable tag"})</p><div className="tags">{Object.entries(tags).map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}</div><small>All raw OSM way tags shown; normalized priorities: {attrs.join(", ")}. Node tags retained in package.</small></div>}
      {error && <div className="error">{error}</div>}
    </section></main><footer>© OpenStreetMap contributors · ODbL · Experimental routes are not a legal access or safety guarantee. Coverage ends at package boundary.</footer>
  </div>;
}

createRoot(document.getElementById("root")!).render(<App/>);
if ("serviceWorker" in navigator && import.meta.env.PROD) navigator.serviceWorker.register("/sw.js").catch(console.error);
