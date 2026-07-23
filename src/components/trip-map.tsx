import type { Feature, FeatureCollection, LineString } from "geojson";
import { X } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import MapView, {
	Layer,
	type MapRef,
	Marker,
	NavigationControl,
	Source,
} from "react-map-gl/maplibre";
import { resolveMediaMapPosition } from "../media/map-position";
import type { MediaBrowserItem, WorkoutWithPoints } from "../media/types";

const DEFAULT_PHOTO_ZOOM = { scale: 1, x: 50, y: 50 };

export function TripMap({
	workouts,
	media,
}: {
	workouts: WorkoutWithPoints[];
	media: MediaBrowserItem[];
}) {
	const mapRef = useRef<MapRef>(null);
	const photoStageRef = useRef<HTMLDivElement>(null);
	const [zoom, setZoom] = useState(3);
	const [selectedPhoto, setSelectedPhoto] = useState<MediaBrowserItem>();
	const [photoZoom, setPhotoZoom] = useState(DEFAULT_PHOTO_ZOOM);
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
	const photos = positions
		.filter(({ item }) => item.kind === "photo")
		.map(({ item }) => item)
		.sort((left, right) => captureTime(left) - captureTime(right));
	const selectedPhotoIndex = selectedPhoto
		? photos.findIndex((item) => item.id === selectedPhoto.id)
		: -1;
	useEffect(() => {
		fitMap(mapRef.current, workouts, media);
	}, [workouts, media]);

	function showPhoto(photo: MediaBrowserItem | undefined) {
		setSelectedPhoto(photo);
		setPhotoZoom(DEFAULT_PHOTO_ZOOM);
		const position = positions.find(
			({ item }) => item.id === photo?.id,
		)?.position;
		if (position) {
			mapRef.current?.easeTo({
				center: [position.longitude, position.latitude],
				duration: 500,
			});
		}
	}

	const zoomPhoto = useEffectEvent((event: WheelEvent) => {
		event.preventDefault();
		const bounds = photoStageRef.current?.getBoundingClientRect();
		if (!bounds) return;
		setPhotoZoom((current) => ({
			scale: Math.min(
				6,
				Math.max(1, current.scale * Math.exp(-event.deltaY * 0.002)),
			),
			x: ((event.clientX - bounds.left) / bounds.width) * 100,
			y: ((event.clientY - bounds.top) / bounds.height) * 100,
		}));
	});

	const navigatePhoto = useEffectEvent((offset: number) => {
		const photo = photos[selectedPhotoIndex + offset];
		if (photo) showPhoto(photo);
	});

	useEffect(() => {
		if (!selectedPhoto) return;
		function handleKeyDown(event: KeyboardEvent) {
			if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
			event.preventDefault();
			navigatePhoto(event.key === "ArrowLeft" ? -1 : 1);
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [selectedPhoto]);

	// The wheel target is mounted only while a photo is selected.
	// biome-ignore lint/correctness/useExhaustiveDependencies: selectedPhoto triggers attachment after mount.
	useEffect(() => {
		const stage = photoStageRef.current;
		if (!stage) return;
		stage.addEventListener("wheel", zoomPhoto, { passive: false });
		return () => stage.removeEventListener("wheel", zoomPhoto);
	}, [selectedPhoto]);

	return (
		<div className={`trip-map ${selectedPhoto ? "has-photo" : ""}`}>
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
				{positions.map(({ item, position }) => {
					const className = `media-marker ${zoom >= 13 ? "close" : ""} ${selectedPhoto?.id === item.id ? "selected" : ""}`;
					return (
						<Marker
							key={item.id}
							longitude={position.longitude}
							latitude={position.latitude}
							anchor="center"
						>
							{item.kind === "photo" ? (
								<button
									type="button"
									className={className}
									aria-label="Open photo"
									onClick={() => showPhoto(item)}
								>
									{zoom >= 13 ? <img src={item.previewUrl} alt="" /> : null}
								</button>
							) : (
								<div className={className}>
									{zoom >= 13 ? <img src={item.previewUrl} alt="" /> : null}
								</div>
							)}
						</Marker>
					);
				})}
			</MapView>
			{selectedPhoto ? (
				<aside className="trip-photo-viewer">
					<button
						type="button"
						className="photo-viewer-close"
						aria-label="Close photo"
						onClick={() => showPhoto(undefined)}
					>
						<X size={18} />
					</button>
					<div ref={photoStageRef} className="trip-photo-stage">
						<img
							src={`/media/${selectedPhoto.id}/viewer`}
							alt="Selected"
							draggable={false}
							style={{
								transform: `scale(${photoZoom.scale})`,
								transformOrigin: `${photoZoom.x}% ${photoZoom.y}%`,
							}}
						/>
					</div>
				</aside>
			) : null}
		</div>
	);
}

function captureTime(media: MediaBrowserItem) {
	const timestamp = Date.parse(media.effectiveCapturedAt ?? "");
	return Number.isFinite(timestamp) ? timestamp : Infinity;
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
