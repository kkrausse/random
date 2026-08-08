import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Camera, Route as RouteIcon } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
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
				<div>
					<p className="eyebrow">
						<RouteIcon size={13} /> Route
					</p>
					<h1>{summary.title ?? "Workout route"}</h1>
				</div>
				<p>
					{formatDateTime(summary.startedAt, detail.trip.timeZone)} ·{" "}
					{formatDistance(summary.distanceMeters)}
				</p>
			</header>
			<section className="trip-map-panel route-map-panel">
				<TripMap
					workouts={[workout]}
					media={photos}
					selectedPhotoId={selectedPhotoId}
					onSelectedPhotoChange={setSelectedPhotoId}
				/>
			</section>
			<div className="trip-content route-detail-content">
				<section className="detail-section">
					<div className="detail-section-heading">
						<div>
							<p className="eyebrow">
								<Camera size={13} /> Along this route
							</p>
							<h2>Photos</h2>
						</div>
						<span className="workout-photo-count">
							{photos.length} photo{photos.length === 1 ? "" : "s"}
						</span>
					</div>
					{photos.length ? (
						<div className="workout-photo-browser">
							{photos.map((photo) => (
								<WorkoutPhoto
									key={photo.id}
									photo={photo}
									isSelected={selectedPhotoId === photo.id}
									timeZone={detail.trip.timeZone}
									onSelect={setSelectedPhotoId}
								/>
							))}
						</div>
					) : (
						<p className="section-empty">
							No library photos fall within this workout's recorded route.
						</p>
					)}
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
}: {
	photo: MediaBrowserItem;
	isSelected: boolean;
	timeZone: string | null;
	onSelect: (id: string) => void;
}) {
	return (
		<button
			type="button"
			className={isSelected ? "selected" : ""}
			onClick={() => onSelect(photo.id)}
		>
			<img src={photo.previewUrl} alt="" loading="lazy" />
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
