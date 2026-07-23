import type { Feature, LineString } from "geojson";
import { useEffect, useRef } from "react";
import MapView, {
	FullscreenControl,
	Layer,
	type MapRef,
	NavigationControl,
	ScaleControl,
	Source,
} from "react-map-gl/maplibre";
import type { WorkoutRoute } from "../lib/apple-health";

import "maplibre-gl/dist/maplibre-gl.css";

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
					</Source>
				)}
			</MapView>
			<div className="map-credit">
				Map tiles by CARTO, OpenStreetMap contributors
			</div>
		</div>
	);
}
