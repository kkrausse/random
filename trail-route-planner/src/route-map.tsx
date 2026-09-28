import { useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection, LineString } from "geojson";
import type { ExpressionSpecification, MapLayerMouseEvent, StyleSpecification } from "maplibre-gl";
import MapView, { Layer, Marker, NavigationControl, ScaleControl, Source, type MapRef } from "react-map-gl/maplibre";
import { interpret, type Access, type Region, type Route } from "./domain";
import type { DistanceUnit } from "./units";
import "maplibre-gl/dist/maplibre-gl.css";

// The routing graph is bundled locally. Tiles are optional context, not a routing dependency.
const mapStyle: StyleSpecification = {
  version: 8,
  sources: {
    basemap: {
      type: "raster",
      tiles: ["https://a.tile.opentopomap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: 'Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM · Style © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#e8ede6" } },
    { id: "basemap", type: "raster", source: "basemap", paint: { "raster-saturation": -0.9, "raster-contrast": -0.18, "raster-opacity": 0.58 } },
  ],
};
const offlineStyle: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#e8ede6" } }],
};

const emptyLines = (): FeatureCollection<LineString> => ({ type: "FeatureCollection", features: [] });
export type MapAccessMode = "motorcycle" | "motorcar" | "bicycle";
const accessModes: { id: MapAccessMode; label: string }[] = [
  { id: "motorcycle", label: "Motorcycle" }, { id: "motorcar", label: "Car" }, { id: "bicycle", label: "Bicycle" },
];
const accessColors: Record<Access, string> = {
  permitted: "#008d69", prohibited: "#d94450", restricted: "#c77c00", unknown: "#6753d4",
};
const accessColorExpression = ["match", ["get", "access"],
  "permitted", accessColors.permitted, "prohibited", accessColors.prohibited,
  "restricted", accessColors.restricted, accessColors.unknown,
] satisfies ExpressionSpecification;
const evidenceColorExpression = ["case", ["==", ["get", "basis"], "inferred"],
  ["match", ["get", "access"], "permitted", "#5fa88a", "prohibited", "#dd8790", accessColorExpression], accessColorExpression,
] satisfies ExpressionSpecification;

interface RouteMapProps {
  region: Region;
  route?: Route;
  start: number;
  inspectedEdge?: number;
  accessMode: MapAccessMode;
  onAccessModeChange: (mode: MapAccessMode) => void;
  units: DistanceUnit;
  onStartChange: (node: number) => void;
  onInspect: (edge: number) => void;
}

export function RouteMap({ region, route, start, inspectedEdge, accessMode, onAccessModeChange, units, onStartChange, onInspect }: RouteMapProps) {
  const mapRef = useRef<MapRef>(null);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  const network = useMemo(() => {
    const features: FeatureCollection<LineString>["features"] = [];
    for (const edge of region.edges) {
      const a = region.nodes[edge.a], b = region.nodes[edge.b];
      features.push({
        type: "Feature", properties: interpret(region.ways[edge.way].tags, accessMode),
        geometry: { type: "LineString", coordinates: [[a.lon, a.lat], [b.lon, b.lat]] },
      });
    }
    return { type: "FeatureCollection", features } satisfies FeatureCollection<LineString>;
  }, [region, accessMode]);
  const routeLines = useMemo(() => {
    if (!route) return emptyLines();
    return {
      type: "FeatureCollection",
      features: [...new Set(route.edges)].map(id => {
        const edge = region.edges[id], a = region.nodes[edge.a], b = region.nodes[edge.b];
        return {
          type: "Feature" as const,
          properties: { edge: id, inspected: id === inspectedEdge, ...interpret(region.ways[edge.way].tags, accessMode) },
          geometry: { type: "LineString" as const, coordinates: [[a.lon, a.lat], [b.lon, b.lat]] },
        };
      }),
    } satisfies FeatureCollection<LineString>;
  }, [region, route, inspectedEdge, accessMode]);

  const fitRoute = () => {
    if (!route?.nodes.length || !mapRef.current) return;
    const points = route.nodes.map(id => region.nodes[id]);
    const width = mapRef.current.getContainer().clientWidth;
    mapRef.current.fitBounds([
      [Math.min(...points.map(p => p.lon)), Math.min(...points.map(p => p.lat))],
      [Math.max(...points.map(p => p.lon)), Math.max(...points.map(p => p.lat))],
    ], { padding: { top: 105, bottom: 80, left: 65, right: width > 850 ? 380 : 65 }, duration: 500, maxZoom: 15 });
  };
  useEffect(() => { fitRoute(); }, [route?.id, region]);

  function handleClick(event: MapLayerMouseEvent) {
    const hit = event.features?.find(feature => feature.layer.id === "route-hit");
    if (typeof hit?.properties?.edge === "number") {
      onInspect(hit.properties.edge);
      return;
    }
    // Clicking empty map space moves the start to the closest graph node; dragging never triggers a map click.
    const { lat, lng } = event.lngLat;
    let nearest = start, distance = Infinity;
    region.nodes.forEach((node, index) => {
      const dx = (node.lon - lng) * Math.cos(lat * Math.PI / 180);
      const dy = node.lat - lat;
      const d = dx * dx + dy * dy;
      if (d < distance) { nearest = index; distance = d; }
    });
    onStartChange(nearest);
  }

  const origin = region.nodes[start];
  return <><MapView
    ref={mapRef}
    initialViewState={{ longitude: origin.lon, latitude: origin.lat, zoom: 12 }}
    mapStyle={online ? mapStyle : offlineStyle}
    onLoad={fitRoute}
    onClick={handleClick}
    interactiveLayerIds={["route-hit"]}
    scrollZoom
    dragPan
    doubleClickZoom
    keyboard
    touchZoomRotate
    cursor="grab"
    reuseMaps={false}
  >
    <NavigationControl position="top-right" showCompass={false}/>
    <ScaleControl position="bottom-left" unit={units === "mi" ? "imperial" : "metric"}/>
    <Source id="network" type="geojson" data={network}>
      <Layer id="network-access" type="line" paint={{ "line-color": evidenceColorExpression, "line-width": 1.5, "line-opacity": ["case", ["==", ["get", "access"], "unknown"], 0.27, 0.42] }}/>
    </Source>
    <Source id="route" type="geojson" data={routeLines}>
      <Layer id="route-casing" type="line" layout={{ "line-cap": "round", "line-join": "round" }} paint={{ "line-color": "#ffffff", "line-width": 11.5 }}/>
      <Layer id="route-line" type="line" layout={{ "line-cap": "round", "line-join": "round" }} paint={{ "line-color": ["case", ["get", "inspected"], "#f5ac20", evidenceColorExpression], "line-width": 6.5 }}/>
      <Layer id="route-hit" type="line" paint={{ "line-color": "#000", "line-width": 18, "line-opacity": 0 }}/>
    </Source>
    <Marker longitude={origin.lon} latitude={origin.lat} anchor="center">
      <div className="start-pin" title="Route start" aria-label="Route start"/>
    </Marker>
  </MapView><div className="access-legend" aria-label="Map access coloring">
    <strong>COLOR BY ACCESS</strong>
    <div className="access-modes" role="group" aria-label="Vehicle type">
      {accessModes.map(mode => <button key={mode.id} type="button" aria-pressed={accessMode === mode.id} onClick={() => onAccessModeChange(mode.id)}>{mode.label}</button>)}
    </div>
    <div className="access-keys">{(Object.entries(accessColors) as [Access, string][]).map(([access, color]) => <span key={access}><i style={{ background: color }}/>{access}</span>)}</div>
    <small>Access tags take priority. Lighter green/red = inferred from road type (cars); purple = unresolved. Not observed traffic.</small>
  </div>{!online && <div className="offline-notice">Offline · local trail network only</div>}</>;
}
