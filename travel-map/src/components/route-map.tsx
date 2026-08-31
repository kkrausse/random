import type { Feature, LineString } from "geojson";
import { useEffect, useRef } from "react";
import MapView, {
	FullscreenControl,
	Layer,
	type MapRef,
	Marker,
	NavigationControl,
	ScaleControl,
	Source,
} from "react-map-gl/maplibre";
import type { WorkoutRoute } from "../lib/apple-health";

type RouteMapProps = {
	route?: WorkoutRoute;
};

const lineLayer = {
	id: "workout-route",
	type: "line" as const,
	paint: {
		"line-color": "#ff5c35",
		"line-width": 5,
		"line-opacity": 0.92,
	},
};

export function RouteMap({ route }: RouteMapProps) {
	const mapRef = useRef<MapRef>(null);
	const coordinates: [number, number][] =
		route?.points.map((point) => [point.longitude, point.latitude]) ?? [];
	const start = route?.points[0];
	const end = route?.points.at(-1);

	useEffect(() => {
		const points = route?.points;
		if (!mapRef.current || !points?.length) return;

		const longitudes = points.map((point) => point.longitude);
		const latitudes = points.map((point) => point.latitude);
		mapRef.current.fitBounds(
			[
				[Math.min(...longitudes), Math.min(...latitudes)],
				[Math.max(...longitudes), Math.max(...latitudes)],
			],
			{ padding: 96, duration: 900, maxZoom: 15 },
		);
	}, [route]);

	const routeGeoJson: Feature<LineString> | undefined =
		coordinates.length > 1
			? {
					type: "Feature",
					properties: {},
					geometry: { type: "LineString", coordinates },
				}
			: undefined;

	return (
		<div className="map-wrap">
			<MapView
				ref={mapRef}
				initialViewState={{ longitude: -98.58, latitude: 39.83, zoom: 3.3 }}
				mapStyle="https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json"
				attributionControl={false}
				boxZoom
				scrollZoom
				doubleClickZoom
				dragPan
				dragRotate
				keyboard
				touchZoomRotate
			>
				<NavigationControl position="top-right" showCompass visualizePitch />
				<FullscreenControl position="top-right" />
				<ScaleControl position="bottom-left" unit="imperial" />
				{routeGeoJson && (
					<Source id="workout-route-source" type="geojson" data={routeGeoJson}>
						<Layer {...lineLayer} />
						<Layer
							id="workout-route-direction"
							type="symbol"
							layout={{
								"symbol-placement": "line",
								"symbol-spacing": 90,
								"text-field": ">",
								"text-size": 18,
								"text-rotation-alignment": "map",
								"text-keep-upright": false,
							}}
							paint={{
								"text-color": "#fff",
								"text-halo-color": "#c74425",
								"text-halo-width": 1,
							}}
						/>
					</Source>
				)}
				{start && (
					<Marker
						longitude={start.longitude}
						latitude={start.latitude}
						anchor="bottom"
					>
						<span className="route-flag start" />
					</Marker>
				)}
				{end && (
					<Marker
						longitude={end.longitude}
						latitude={end.latitude}
						anchor="bottom"
					>
						<span className="route-flag end" />
					</Marker>
				)}
			</MapView>
			<div className="map-credit">
				Map tiles by CARTO, OpenStreetMap contributors
			</div>
		</div>
	);
}
