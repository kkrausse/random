import type { Feature, LineString } from "geojson";
import { useEffect, useMemo, useRef } from "react";
import MapView, {
	Layer,
	type MapRef,
	Marker,
	Source,
} from "react-map-gl/maplibre";
import type { WorkoutWithPoints } from "../media/types";

export function RoutePreviewMap({ workout }: { workout: WorkoutWithPoints }) {
	const mapRef = useRef<MapRef>(null);
	const route = useMemo<Feature<LineString>>(
		() => ({
			type: "Feature",
			properties: {},
			geometry: {
				type: "LineString",
				coordinates: workout.points.map((point) => [
					point.longitude,
					point.latitude,
				]),
			},
		}),
		[workout],
	);
	useEffect(() => fitPreview(mapRef.current, workout), [workout]);
	const start = workout.points[0];
	const end = workout.points.at(-1);

	return (
		<div className="route-preview-map" aria-hidden="true">
			<MapView
				ref={mapRef}
				initialViewState={{ longitude: -98.58, latitude: 39.83, zoom: 3 }}
				mapStyle="https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json"
				attributionControl={false}
				interactive={false}
				onLoad={() => fitPreview(mapRef.current, workout)}
			>
				{workout.points.length > 1 && (
					<Source id={`preview-${workout.id}`} type="geojson" data={route}>
						<Layer
							id={`preview-line-${workout.id}`}
							type="line"
							paint={{
								"line-color": "#e85d36",
								"line-width": 3,
								"line-opacity": 0.9,
							}}
						/>
					</Source>
				)}
				{start && (
					<Marker longitude={start.longitude} latitude={start.latitude}>
						<span className="route-point start" />
					</Marker>
				)}
				{end && (
					<Marker longitude={end.longitude} latitude={end.latitude}>
						<span className="route-point end" />
					</Marker>
				)}
			</MapView>
		</div>
	);
}

function fitPreview(map: MapRef | null, workout: WorkoutWithPoints) {
	if (!map || !workout.points.length) return;
	const longitudes = workout.points.map((point) => point.longitude);
	const latitudes = workout.points.map((point) => point.latitude);
	map.fitBounds(
		[
			[Math.min(...longitudes), Math.min(...latitudes)],
			[Math.max(...longitudes), Math.max(...latitudes)],
		],
		{ padding: 18, maxZoom: 14, duration: 0 },
	);
}
