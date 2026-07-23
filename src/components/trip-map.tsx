import type { Feature, FeatureCollection, LineString } from "geojson";
import { useEffect, useRef, useState } from "react";
import MapView, {
	Layer,
	type MapRef,
	Marker,
	NavigationControl,
	Source,
} from "react-map-gl/maplibre";
import { resolveMediaMapPosition } from "../media/map-position";
import type { MediaBrowserItem, WorkoutWithPoints } from "../media/types";

export function TripMap({
	workouts,
	media,
}: {
	workouts: WorkoutWithPoints[];
	media: MediaBrowserItem[];
}) {
	const mapRef = useRef<MapRef>(null);
	const [zoom, setZoom] = useState(3);
	const routes: FeatureCollection<LineString> = {
		type: "FeatureCollection",
		features: workouts
			.filter((workout) => workout.points.length > 1)
			.map(
				(workout): Feature<LineString> => ({
					type: "Feature",
					properties: { id: workout.id },
					geometry: {
						type: "LineString",
						coordinates: workout.points.map((point) => [
							point.longitude,
							point.latitude,
						]),
					},
				}),
			),
	};
	const positions = media
		.map((item) => ({
			item,
			position: resolveMediaMapPosition({ media: item, workouts }),
		}))
		.filter(
			(
				value,
			): value is {
				item: MediaBrowserItem;
				position: NonNullable<typeof value.position>;
			} => value.position !== null,
		);
	useEffect(() => {
		fitMap(mapRef.current, workouts, media);
	}, [workouts, media]);

	return (
		<div className="trip-map">
			<MapView
				ref={mapRef}
				initialViewState={{ longitude: -98.58, latitude: 39.83, zoom: 3 }}
				mapStyle="https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json"
				onLoad={() => fitMap(mapRef.current, workouts, media)}
				onZoom={(event) => setZoom(event.viewState.zoom)}
			>
				<NavigationControl position="top-right" />
				{routes.features.length > 0 && (
					<Source id="trip-routes" type="geojson" data={routes}>
						<Layer
							id="trip-routes-line"
							type="line"
							paint={{
								"line-color": "#e85d36",
								"line-width": 4,
								"line-opacity": 0.88,
							}}
						/>
					</Source>
				)}
				{positions.map(({ item, position }) => (
					<Marker
						key={item.id}
						longitude={position.longitude}
						latitude={position.latitude}
						anchor="center"
					>
						<div className={`media-marker ${zoom >= 13 ? "close" : ""}`}>
							{zoom >= 13 ? <img src={item.previewUrl} alt="" /> : null}
						</div>
					</Marker>
				))}
			</MapView>
		</div>
	);
}

function fitMap(
	map: MapRef | null,
	workouts: WorkoutWithPoints[],
	media: MediaBrowserItem[],
) {
	const mediaPositions = media
		.map((item) => resolveMediaMapPosition({ media: item, workouts }))
		.filter(
			(position): position is NonNullable<typeof position> => position !== null,
		);
	const coordinates = [
		...workouts.flatMap((workout) =>
			workout.points.map(
				(point) => [point.longitude, point.latitude] as [number, number],
			),
		),
		...mediaPositions.map(
			(position) => [position.longitude, position.latitude] as [number, number],
		),
	];
	if (!coordinates.length || !map) return;

	let west = Infinity,
		south = Infinity,
		east = -Infinity,
		north = -Infinity;
	for (const [longitude, latitude] of coordinates) {
		west = Math.min(west, longitude);
		east = Math.max(east, longitude);
		south = Math.min(south, latitude);
		north = Math.max(north, latitude);
	}
	map.fitBounds(
		[
			[west, south],
			[east, north],
		],
		{ padding: 54, maxZoom: 15, duration: 600 },
	);
}
