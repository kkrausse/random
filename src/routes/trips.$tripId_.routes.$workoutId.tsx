import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowLeft,
	Camera,
	Images,
	Map as MapIcon,
	Minus,
	Plus,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { TripMap } from "../components/trip-map";
import type { TripRecord, WorkoutListItem } from "../db/library";
import { mediaInterpolatesOntoWorkout } from "../media/map-position";
import type { MediaBrowserItem, WorkoutWithPoints } from "../media/types";

export const Route = createFileRoute("/trips/$tripId_/routes/$workoutId")({
	component: WorkoutDetail,
});

type Detail = {
	trip: TripRecord;
	media: MediaBrowserItem[];
	workouts: WorkoutListItem[];
	workoutsWithPoints: WorkoutWithPoints[];
};

function WorkoutDetail() {
	const { tripId, workoutId } = Route.useParams();
	const [detail, setDetail] = useState<Detail>();
	const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
	const [galleryZoom, setGalleryZoom] = useState(0);
	const [activeView, setActiveView] = useState<"map" | "photos">("map");
	const photosViewRef = useRef<HTMLElement>(null);

	useEffect(() => {
		let active = true;
		void fetch(`/api/trips/${tripId}`).then(async (response) => {
			if (active && response.ok) setDetail(await response.json());
		});
		return () => {
			active = false;
		};
	}, [tripId]);

	const workout = detail?.workoutsWithPoints.find(
		(item) => item.id === workoutId,
	);
	const summary = detail?.workouts.find((item) => item.id === workoutId);
	const photos = useMemo(
		() =>
			workout
				? (detail?.media.filter(
						(item) =>
							item.kind === "photo" &&
							mediaInterpolatesOntoWorkout(item, workout),
					) ?? [])
				: [],
		[detail?.media, workout],
	);
	useEffect(() => {
		if (!detail) return;
		const view = photosViewRef.current;
		if (!view) return;
		let wheelDistance = 0;
		let wheelResetTimer: number | undefined;
		let touchDistance: number | undefined;
		let didPinch = false;
		let pinchResetTimer: number | undefined;

		function changeZoom(direction: -1 | 1) {
			setGalleryZoom((current) =>
				Math.min(2, Math.max(0, current + direction)),
			);
		}

		function handleWheel(event: WheelEvent) {
			if (!event.ctrlKey && !event.metaKey) return;
			event.preventDefault();
			wheelDistance -= event.deltaY;
			if (Math.abs(wheelDistance) >= 24) {
				changeZoom(wheelDistance > 0 ? 1 : -1);
				wheelDistance = 0;
			}
			window.clearTimeout(wheelResetTimer);
			wheelResetTimer = window.setTimeout(() => {
				wheelDistance = 0;
			}, 180);
		}

		function handleTouchStart(event: TouchEvent) {
			if (event.touches.length !== 2) return;
			window.clearTimeout(pinchResetTimer);
			didPinch = false;
			touchDistance = distanceBetweenTouches(event.touches);
		}

		function handleTouchMove(event: TouchEvent) {
			if (event.touches.length !== 2 || touchDistance === undefined) return;
			event.preventDefault();
			didPinch = true;
			const distance = distanceBetweenTouches(event.touches);
			const ratio = distance / touchDistance;
			if (ratio > 1.16) {
				changeZoom(1);
				touchDistance = distance;
			} else if (ratio < 0.86) {
				changeZoom(-1);
				touchDistance = distance;
			}
		}

		function handleTouchEnd(event: TouchEvent) {
			if (event.touches.length >= 2) return;
			touchDistance = undefined;
			pinchResetTimer = window.setTimeout(() => {
				didPinch = false;
			}, 0);
		}

		function suppressPinchClick(event: MouseEvent) {
			if (!didPinch) return;
			event.preventDefault();
			event.stopPropagation();
		}

		view.addEventListener("wheel", handleWheel, { passive: false });
		view.addEventListener("touchstart", handleTouchStart, { passive: true });
		view.addEventListener("touchmove", handleTouchMove, { passive: false });
		view.addEventListener("touchend", handleTouchEnd, { passive: true });
		view.addEventListener("touchcancel", handleTouchEnd, { passive: true });
		view.addEventListener("click", suppressPinchClick, true);
		return () => {
			window.clearTimeout(wheelResetTimer);
			window.clearTimeout(pinchResetTimer);
			view.removeEventListener("wheel", handleWheel);
			view.removeEventListener("touchstart", handleTouchStart);
			view.removeEventListener("touchmove", handleTouchMove);
			view.removeEventListener("touchend", handleTouchEnd);
			view.removeEventListener("touchcancel", handleTouchEnd);
			view.removeEventListener("click", suppressPinchClick, true);
		};
	}, [detail]);

	if (!detail) return <main className="detail-loading">Opening route...</main>;
	if (!workout || !summary)
		return (
			<main className="not-found">
				<h1>Route not found</h1>
				<Link to="/trips/$tripId" params={{ tripId }}>
					Back to trip
				</Link>
			</main>
		);

	return (
		<main className="trip-detail-page route-detail-page">
			<header className="route-detail-header">
				<Link to="/trips/$tripId" params={{ tripId }}>
					<ArrowLeft size={15} /> {detail.trip.title}
				</Link>
				<p>
					{formatDateTime(summary.startedAt, detail.trip.timeZone)} ·{" "}
					{formatDistance(summary.distanceMeters)}
				</p>
			</header>
			<nav className="route-view-tabs" aria-label="Route view">
				<button
					type="button"
					className={activeView === "map" ? "active" : ""}
					aria-pressed={activeView === "map"}
					onClick={() => setActiveView("map")}
				>
					<MapIcon size={15} /> Map
				</button>
				<button
					type="button"
					className={activeView === "photos" ? "active" : ""}
					aria-pressed={activeView === "photos"}
					onClick={() => setActiveView("photos")}
				>
					<Images size={15} /> Photos
				</button>
			</nav>
			<div className="route-view-stack">
				<section
					className={`trip-map-panel route-map-panel route-view ${activeView === "map" ? "active" : ""} ${selectedPhotoId ? "is-viewing-photo" : ""}`}
					aria-label="Map view"
				>
					<TripMap
						workouts={[workout]}
						media={photos}
						selectedPhotoId={selectedPhotoId}
						onSelectedPhotoChange={setSelectedPhotoId}
					/>
				</section>
				<section
					ref={photosViewRef}
					className={`route-photos-view route-view ${activeView === "photos" ? "active" : ""}`}
					aria-label="Photos view"
				>
					<div className="route-photos-content">
						<div className="detail-section-heading">
							<div>
								<p className="eyebrow">
									<Camera size={13} /> Along this route
								</p>
								<h2>Photos</h2>
							</div>
							<div className="workout-photo-heading-tools">
								<span className="workout-photo-count">
									{photos.length} photo{photos.length === 1 ? "" : "s"}
								</span>
								<fieldset className="gallery-zoom">
									<legend className="sr-only">Gallery zoom</legend>
									<button
										type="button"
										aria-label="Zoom gallery out"
										disabled={galleryZoom === 0}
										onClick={() => setGalleryZoom((current) => current - 1)}
									>
										<Minus size={14} />
									</button>
									<input
										type="range"
										min="0"
										max="2"
										step="1"
										value={galleryZoom}
										aria-label="Gallery size"
										onChange={(event) =>
											setGalleryZoom(Number(event.target.value))
										}
									/>
									<button
										type="button"
										aria-label="Zoom gallery in"
										disabled={galleryZoom === 2}
										onClick={() => setGalleryZoom((current) => current + 1)}
									>
										<Plus size={14} />
									</button>
								</fieldset>
							</div>
						</div>
						{photos.length ? (
							<div className="workout-photo-browser" data-zoom={galleryZoom}>
								{photos.map((photo) => (
									<WorkoutPhoto
										key={photo.id}
										photo={photo}
										isSelected={selectedPhotoId === photo.id}
										timeZone={detail.trip.timeZone}
										onSelect={setSelectedPhotoId}
										useViewerImage={galleryZoom >= 1}
									/>
								))}
							</div>
						) : (
							<p className="section-empty">
								No library photos fall within this workout's recorded route.
							</p>
						)}
					</div>
				</section>
			</div>
		</main>
	);
}

const WorkoutPhoto = memo(function WorkoutPhoto({
	photo,
	isSelected,
	timeZone,
	onSelect,
	useViewerImage,
}: {
	photo: MediaBrowserItem;
	isSelected: boolean;
	timeZone: string | null;
	onSelect: (id: string) => void;
	useViewerImage: boolean;
}) {
	return (
		<button
			type="button"
			className={isSelected ? "selected" : ""}
			onClick={() => onSelect(photo.id)}
		>
			<img
				src={useViewerImage ? `/media/${photo.id}/viewer` : photo.previewUrl}
				alt=""
				loading="lazy"
			/>
			<span>{formatPhotoTime(photo.effectiveCapturedAt, timeZone)}</span>
		</button>
	);
});

function formatDistance(meters: number | null) {
	return meters === null
		? "Distance unavailable"
		: `${(meters / 1609.344).toFixed(1)} mi`;
}

function formatDateTime(value: string, timeZone: string | null) {
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
		...(timeZone ? { timeZone } : {}),
	}).format(new Date(value));
}

function formatPhotoTime(value: string | null, timeZone: string | null) {
	if (!value) return "Time unavailable";
	return new Intl.DateTimeFormat(undefined, {
		timeStyle: "short",
		...(timeZone ? { timeZone } : {}),
	}).format(new Date(value));
}

function distanceBetweenTouches(touches: TouchList) {
	const first = touches[0];
	const second = touches[1];
	return Math.hypot(
		second.clientX - first.clientX,
		second.clientY - first.clientY,
	);
}
