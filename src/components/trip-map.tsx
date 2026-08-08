import type { Feature, FeatureCollection, LineString } from "geojson";
import { ChevronLeft, ChevronRight, MoveDiagonal2, X } from "lucide-react";
import {
	memo,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useEffectEvent,
	useMemo,
	useRef,
	useState,
} from "react";
import MapView, {
	Layer,
	type MapRef,
	Marker,
	NavigationControl,
	Source,
} from "react-map-gl/maplibre";
import { resolveMediaMapPosition } from "../media/map-position";
import type {
	MediaBrowserItem,
	ResolvedMediaPosition,
	WorkoutWithPoints,
} from "../media/types";

const DEFAULT_PHOTO_ZOOM = { scale: 1, offsetX: 0, offsetY: 0 };

export function TripMap({
	workouts,
	media,
	selectedPhotoId,
	onSelectedPhotoChange,
}: {
	workouts: WorkoutWithPoints[];
	media: MediaBrowserItem[];
	selectedPhotoId?: string | null;
	onSelectedPhotoChange?: (id: string | null) => void;
}) {
	const mapRef = useRef<MapRef>(null);
	const mapContainerRef = useRef<HTMLDivElement>(null);
	const photoStageRef = useRef<HTMLDivElement>(null);
	const photoDragRef = useRef<{
		pointerId: number;
		x: number;
		y: number;
		offsetX: number;
		offsetY: number;
	}>();
	const photoPointersRef = useRef(new Map<number, { x: number; y: number }>());
	const photoPinchRef = useRef<{
		distance: number;
		scale: number;
		centerX: number;
		centerY: number;
		offsetX: number;
		offsetY: number;
	}>();
	const mapResizeRef = useRef<{
		pointerId: number;
		x: number;
		y: number;
		width: number;
		height: number;
		maxWidth: number;
		maxHeight: number;
	}>();
	const [zoom, setZoom] = useState(3);
	const [internalSelectedPhoto, setInternalSelectedPhoto] =
		useState<MediaBrowserItem>();
	const [photoZoom, setPhotoZoom] = useState(DEFAULT_PHOTO_ZOOM);
	const [isDraggingPhoto, setIsDraggingPhoto] = useState(false);
	const routes: FeatureCollection<LineString> = useMemo(
		() => ({
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
		}),
		[workouts],
	);
	const routeEndpoints = useMemo(
		() =>
			workouts.flatMap((workout) => {
				const start = workout.points[0];
				const end = workout.points.at(-1);
				return start && end ? [{ workoutId: workout.id, start, end }] : [];
			}),
		[workouts],
	);
	const positions = useMemo(
		() =>
			media
				.map((item) => ({
					item,
					position: resolveMediaMapPosition({ media: item, workouts }),
				}))
				.filter(
					(
						value,
					): value is {
						item: MediaBrowserItem;
						position: ResolvedMediaPosition;
					} => value.position !== null,
				),
		[media, workouts],
	);
	const photos = useMemo(
		() =>
			positions
				.filter(({ item }) => item.kind === "photo")
				.map(({ item }) => item)
				.sort((left, right) => captureTime(left) - captureTime(right)),
		[positions],
	);
	const photoIndexById = useMemo(
		() => new Map(photos.map((photo, index) => [photo.id, index])),
		[photos],
	);
	const positionById = useMemo(
		() => new Map(positions.map(({ item, position }) => [item.id, position])),
		[positions],
	);
	const selectedPhoto =
		selectedPhotoId === undefined
			? internalSelectedPhoto
			: photos[photoIndexById.get(selectedPhotoId ?? "") ?? -1];
	const selectedPhotoIndex = selectedPhoto
		? (photoIndexById.get(selectedPhoto.id) ?? -1)
		: -1;
	useEffect(() => {
		fitMap(mapRef.current, workouts, positions);
	}, [workouts, positions]);
	useEffect(() => {
		if (!mapContainerRef.current || typeof ResizeObserver === "undefined")
			return;
		const observer = new ResizeObserver(() => mapRef.current?.resize());
		observer.observe(mapContainerRef.current);
		return () => observer.disconnect();
	}, []);
	const focusSelectedPhoto = useEffectEvent((photoId: string | undefined) => {
		const map = mapRef.current;
		if (!map) return;
		map.resize();
		const position = photoId ? positionById.get(photoId) : undefined;
		if (position) {
			map.easeTo({
				center: [position.longitude, position.latitude],
				zoom: Math.max(map.getZoom(), 14),
				duration: 500,
			});
		} else {
			fitMap(map, workouts, positions);
		}
	});
	useEffect(() => {
		setPhotoZoom(DEFAULT_PHOTO_ZOOM);
		setIsDraggingPhoto(false);
		photoDragRef.current = undefined;
		photoPointersRef.current.clear();
		photoPinchRef.current = undefined;
		const frame = requestAnimationFrame(() =>
			focusSelectedPhoto(selectedPhoto?.id),
		);
		return () => cancelAnimationFrame(frame);
	}, [selectedPhoto?.id]);

	const isPhotoSelectionControlled = selectedPhotoId !== undefined;
	const showPhoto = useCallback(
		(photo: MediaBrowserItem | undefined) => {
			if (!isPhotoSelectionControlled) setInternalSelectedPhoto(photo);
			onSelectedPhotoChange?.(photo?.id ?? null);
		},
		[isPhotoSelectionControlled, onSelectedPhotoChange],
	);

	const zoomPhoto = useEffectEvent((event: WheelEvent) => {
		event.preventDefault();
		const bounds = photoStageRef.current?.getBoundingClientRect();
		if (!bounds) return;
		setPhotoZoom((current) => {
			const scale = Math.min(
				6,
				Math.max(1, current.scale * Math.exp(-event.deltaY * 0.002)),
			);
			if (scale === 1) return DEFAULT_PHOTO_ZOOM;
			const ratio = scale / current.scale;
			const pointerX = event.clientX - bounds.left - bounds.width / 2;
			const pointerY = event.clientY - bounds.top - bounds.height / 2;
			return {
				scale,
				offsetX: clampPhotoOffset(
					pointerX - (pointerX - current.offsetX) * ratio,
					bounds.width,
					scale,
				),
				offsetY: clampPhotoOffset(
					pointerY - (pointerY - current.offsetY) * ratio,
					bounds.height,
					scale,
				),
			};
		});
	});

	function startPhotoDrag(event: ReactPointerEvent<HTMLDivElement>) {
		event.currentTarget.setPointerCapture(event.pointerId);
		photoPointersRef.current.set(event.pointerId, {
			x: event.clientX,
			y: event.clientY,
		});
		const pointers = [...photoPointersRef.current.values()];
		if (pointers.length === 2) {
			photoPinchRef.current = {
				distance: pointerDistance(pointers[0], pointers[1]),
				scale: photoZoom.scale,
				centerX: (pointers[0].x + pointers[1].x) / 2,
				centerY: (pointers[0].y + pointers[1].y) / 2,
				offsetX: photoZoom.offsetX,
				offsetY: photoZoom.offsetY,
			};
			setIsDraggingPhoto(true);
			return;
		}
		if (photoZoom.scale <= 1) return;
		photoDragRef.current = {
			pointerId: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			offsetX: photoZoom.offsetX,
			offsetY: photoZoom.offsetY,
		};
		setIsDraggingPhoto(true);
	}

	function dragPhoto(event: ReactPointerEvent<HTMLDivElement>) {
		if (photoPointersRef.current.has(event.pointerId)) {
			photoPointersRef.current.set(event.pointerId, {
				x: event.clientX,
				y: event.clientY,
			});
		}
		const pinch = photoPinchRef.current;
		const pointers = [...photoPointersRef.current.values()];
		if (pinch && pointers.length >= 2) {
			const bounds = event.currentTarget.getBoundingClientRect();
			const centerX = (pointers[0].x + pointers[1].x) / 2;
			const centerY = (pointers[0].y + pointers[1].y) / 2;
			const scale = Math.min(
				6,
				Math.max(
					1,
					pinch.scale *
						(pointerDistance(pointers[0], pointers[1]) / pinch.distance),
				),
			);
			setPhotoZoom(
				scale === 1
					? DEFAULT_PHOTO_ZOOM
					: {
							scale,
							offsetX: clampPhotoOffset(
								pinch.offsetX + centerX - pinch.centerX,
								bounds.width,
								scale,
							),
							offsetY: clampPhotoOffset(
								pinch.offsetY + centerY - pinch.centerY,
								bounds.height,
								scale,
							),
						},
			);
			return;
		}
		const drag = photoDragRef.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		const bounds = event.currentTarget.getBoundingClientRect();
		setPhotoZoom((current) => ({
			...current,
			offsetX: clampPhotoOffset(
				drag.offsetX + event.clientX - drag.x,
				bounds.width,
				current.scale,
			),
			offsetY: clampPhotoOffset(
				drag.offsetY + event.clientY - drag.y,
				bounds.height,
				current.scale,
			),
		}));
	}

	function stopPhotoDrag(event: ReactPointerEvent<HTMLDivElement>) {
		photoPointersRef.current.delete(event.pointerId);
		if (photoPointersRef.current.size < 2) photoPinchRef.current = undefined;
		if (photoDragRef.current?.pointerId === event.pointerId)
			photoDragRef.current = undefined;
		setIsDraggingPhoto(false);
	}

	function startMapResize(event: ReactPointerEvent<HTMLButtonElement>) {
		const container = mapContainerRef.current;
		const parent = container?.parentElement;
		if (!container || !parent) return;
		const bounds = container.getBoundingClientRect();
		const parentBounds = parent.getBoundingClientRect();
		const style = getComputedStyle(container);
		event.currentTarget.setPointerCapture(event.pointerId);
		mapResizeRef.current = {
			pointerId: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			width: bounds.width,
			height: bounds.height,
			maxWidth: parentBounds.width - Number.parseFloat(style.left) - 10,
			maxHeight: parentBounds.height - Number.parseFloat(style.bottom) - 10,
		};
	}

	function resizeMap(event: ReactPointerEvent<HTMLButtonElement>) {
		const resize = mapResizeRef.current;
		const container = mapContainerRef.current;
		if (!resize || resize.pointerId !== event.pointerId || !container) return;
		container.style.width = `${Math.min(resize.maxWidth, Math.max(140, resize.width + event.clientX - resize.x))}px`;
		container.style.height = `${Math.min(resize.maxHeight, Math.max(140, resize.height - event.clientY + resize.y))}px`;
	}

	function stopMapResize(event: ReactPointerEvent<HTMLButtonElement>) {
		if (mapResizeRef.current?.pointerId !== event.pointerId) return;
		mapResizeRef.current = undefined;
	}

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
	useEffect(() => {
		for (const index of [selectedPhotoIndex - 1, selectedPhotoIndex + 1]) {
			const photo = photos[index];
			if (photo) new Image().src = `/media/${photo.id}/viewer`;
		}
	}, [photos, selectedPhotoIndex]);

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
					<div
						ref={photoStageRef}
						className={`trip-photo-stage ${photoZoom.scale > 1 ? "can-pan" : ""} ${isDraggingPhoto ? "dragging" : ""}`}
						onPointerDown={startPhotoDrag}
						onPointerMove={dragPhoto}
						onPointerUp={stopPhotoDrag}
						onPointerCancel={stopPhotoDrag}
					>
						<img
							src={`/media/${selectedPhoto.id}/${photoZoom.scale > 1 ? "max" : "viewer"}`}
							alt="Selected"
							draggable={false}
							style={{
								transform: `translate(${photoZoom.offsetX}px, ${photoZoom.offsetY}px) scale(${photoZoom.scale})`,
							}}
						/>
					</div>
					<nav
						className="photo-viewer-navigation"
						aria-label="Photo navigation"
					>
						<button
							type="button"
							aria-label="Previous photo"
							disabled={selectedPhotoIndex <= 0}
							onClick={() => navigatePhoto(-1)}
						>
							<ChevronLeft size={20} />
						</button>
						<span>
							{selectedPhotoIndex + 1} / {photos.length}
						</span>
						<button
							type="button"
							aria-label="Next photo"
							disabled={selectedPhotoIndex >= photos.length - 1}
							onClick={() => navigatePhoto(1)}
						>
							<ChevronRight size={20} />
						</button>
					</nav>
				</aside>
			) : null}
			<div
				ref={mapContainerRef}
				className={selectedPhoto ? "trip-map-overlay" : "trip-map-canvas"}
			>
				<MapView
					ref={mapRef}
					initialViewState={{ longitude: -98.58, latitude: 39.83, zoom: 3 }}
					mapStyle="https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json"
					onLoad={() => fitMap(mapRef.current, workouts, positions)}
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
							<Layer
								id="trip-routes-direction"
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
									"text-color": "#fffaf3",
									"text-halo-color": "#c74425",
									"text-halo-width": 1,
								}}
							/>
						</Source>
					)}
					{routeEndpoints.flatMap(({ workoutId, start, end }) => [
						<Marker
							key={`${workoutId}-start`}
							longitude={start.longitude}
							latitude={start.latitude}
							anchor="center"
						>
							<span className="route-point start" />
						</Marker>,
						<Marker
							key={`${workoutId}-end`}
							longitude={end.longitude}
							latitude={end.latitude}
							anchor="center"
						>
							<span className="route-point end" />
						</Marker>,
					])}
					{positions.map(({ item, position }) => (
						<MediaMarker
							key={item.id}
							item={item}
							position={position}
							isClose={zoom >= 13}
							isSelected={selectedPhoto?.id === item.id}
							onSelect={showPhoto}
						/>
					))}
				</MapView>
				{selectedPhoto ? (
					<button
						type="button"
						className="trip-map-resize-handle"
						aria-label="Resize map"
						onPointerDown={startMapResize}
						onPointerMove={resizeMap}
						onPointerUp={stopMapResize}
						onPointerCancel={stopMapResize}
					>
						<MoveDiagonal2 size={18} />
					</button>
				) : null}
			</div>
		</div>
	);
}

const MediaMarker = memo(function MediaMarker({
	item,
	position,
	isClose,
	isSelected,
	onSelect,
}: {
	item: MediaBrowserItem;
	position: ResolvedMediaPosition;
	isClose: boolean;
	isSelected: boolean;
	onSelect: (item: MediaBrowserItem) => void;
}) {
	const className = `media-marker ${isClose ? "close" : ""} ${isSelected ? "selected" : ""}`;
	return (
		<Marker
			longitude={position.longitude}
			latitude={position.latitude}
			anchor="center"
		>
			{item.kind === "photo" ? (
				<button
					type="button"
					className={className}
					aria-label="Open photo"
					onClick={() => onSelect(item)}
				>
					{isClose ? <img src={item.previewUrl} alt="" /> : null}
				</button>
			) : (
				<div className={className}>
					{isClose ? <img src={item.previewUrl} alt="" /> : null}
				</div>
			)}
		</Marker>
	);
});

function clampPhotoOffset(offset: number, viewportSize: number, scale: number) {
	const limit = (viewportSize * (scale - 1)) / 2;
	return Math.min(limit, Math.max(-limit, offset));
}

function pointerDistance(
	left: { x: number; y: number },
	right: { x: number; y: number },
) {
	return Math.hypot(right.x - left.x, right.y - left.y) || 1;
}

function captureTime(media: MediaBrowserItem) {
	const timestamp = Date.parse(media.effectiveCapturedAt ?? "");
	return Number.isFinite(timestamp) ? timestamp : Infinity;
}

function fitMap(
	map: MapRef | null,
	workouts: WorkoutWithPoints[],
	positions: { position: ResolvedMediaPosition }[],
) {
	const coordinates = [
		...workouts.flatMap((workout) =>
			workout.points.map(
				(point) => [point.longitude, point.latitude] as [number, number],
			),
		),
		...positions.map(
			({ position }) =>
				[position.longitude, position.latitude] as [number, number],
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
