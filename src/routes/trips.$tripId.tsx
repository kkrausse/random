import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Check, Dumbbell, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MediaBrowser } from "../components/media-browser";
import { TripMap } from "../components/trip-map";
import { Button } from "../components/ui/button";
import type { TripRecord, WorkoutListItem } from "../db/library";
import type { MediaBrowserItem, WorkoutWithPoints } from "../media/types";

export const Route = createFileRoute("/trips/$tripId")({
	component: TripDetail,
});

type Detail = {
	trip: TripRecord;
	media: MediaBrowserItem[];
	workouts: WorkoutListItem[];
	workoutsWithPoints: WorkoutWithPoints[];
};

function TripDetail() {
	const { tripId } = Route.useParams();
	const [detail, setDetail] = useState<Detail>();
	const [title, setTitle] = useState("");
	const [unassigned, setUnassigned] = useState<WorkoutListItem[]>([]);
	const [workoutSelection, setWorkoutSelection] = useState<Set<string>>(
		new Set(),
	);
	const [previewWorkout, setPreviewWorkout] = useState<WorkoutWithPoints>();
	const [query, setQuery] = useState("");
	const [showWorkouts, setShowWorkouts] = useState(false);
	const workoutFile = useRef<HTMLInputElement>(null);
	useEffect(() => {
		void fetch(`/api/trips/${tripId}`).then(async (response) => {
			if (!response.ok) return;
			const value: Detail = await response.json();
			setDetail(value);
			setTitle(value.trip.title);
		});
	}, [tripId]);

	async function load() {
		const response = await fetch(`/api/trips/${tripId}`);
		if (!response.ok) return;
		const value: Detail = await response.json();
		setDetail(value);
		setTitle(value.trip.title);
	}

	async function saveTitle() {
		if (!title.trim() || title === detail?.trip.title) return;
		await patch({ title });
		await load();
	}

	async function findWorkouts(search = query) {
		const params = new URLSearchParams({ unassigned: "true", query: search });
		const response = await fetch(`/api/workouts?${params}`);
		if (response.ok) setUnassigned(await response.json());
		setShowWorkouts(true);
	}

	async function uploadWorkout(file: File) {
		const form = new FormData();
		form.set("file", file);
		await fetch("/api/workouts", { method: "POST", body: form });
		await findWorkouts();
	}

	async function assignWorkouts() {
		await patch({ assignWorkoutIds: [...workoutSelection] });
		setWorkoutSelection(new Set());
		setShowWorkouts(false);
		await load();
	}

	async function previewWorkoutRoute(id: string) {
		const response = await fetch(`/api/workouts?id=${encodeURIComponent(id)}`);
		if (response.ok) setPreviewWorkout(await response.json());
	}

	async function patch(body: object) {
		await fetch(`/api/trips/${tripId}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	if (!detail) return <main className="detail-loading">Opening trip...</main>;
	return (
		<main className="trip-detail-page">
			<header className="trip-detail-header">
				<Link to="/">
					<ArrowLeft size={15} /> Trips
				</Link>
				<input
					aria-label="Trip title"
					value={title}
					onChange={(event) => setTitle(event.target.value)}
					onBlur={() => void saveTitle()}
				/>
				<p>
					{detail.workouts.length} workout
					{detail.workouts.length === 1 ? "" : "s"} ·{" "}
					{detail.media.filter((item) => item.isInCurrentTrip).length} media
					items
				</p>
			</header>
			<section className="trip-map-panel">
				<TripMap
					workouts={detail.workoutsWithPoints}
					media={detail.media.filter((item) => item.isInCurrentTrip)}
				/>
			</section>
			<div className="trip-content">
				<section className="detail-section">
					<div className="detail-section-heading">
						<div>
							<p className="eyebrow">
								<Dumbbell size={13} /> Routes
							</p>
							<h2>Workouts</h2>
						</div>
						<div>
							<input
								ref={workoutFile}
								className="sr-only"
								type="file"
								accept=".zip,application/zip"
								onChange={(event) => {
									const file = event.target.files?.[0];
									if (file) void uploadWorkout(file);
									event.target.value = "";
								}}
							/>
							<Button
								variant="outline"
								onClick={() => workoutFile.current?.click()}
							>
								<Upload size={14} /> Upload export
							</Button>
							<Button onClick={() => void findWorkouts()}>
								Choose imported
							</Button>
						</div>
					</div>
					{detail.workouts.length === 0 ? (
						<p className="section-empty">
							No workouts assigned. Upload an Apple Health export or choose an
							imported route.
						</p>
					) : (
						<div className="assigned-workouts">
							{detail.workouts.map((workout) => (
								<div key={workout.id}>
									<strong>{workout.title ?? "Workout route"}</strong>
									<span>
										{new Date(workout.startedAt).toLocaleString()} ·{" "}
										{formatDistance(workout.distanceMeters)}
									</span>
								</div>
							))}
						</div>
					)}
					{showWorkouts && (
						<div className="workout-selector">
							<div className="selector-search">
								<input
									value={query}
									placeholder="Search title or activity"
									onChange={(event) => {
										setQuery(event.target.value);
										void findWorkouts(event.target.value);
									}}
								/>
								<Button
									disabled={!workoutSelection.size}
									onClick={() => void assignWorkouts()}
								>
									<Check size={14} /> Add selected
								</Button>
							</div>
							{unassigned.map((workout) => (
								<label key={workout.id}>
									<input
										type="checkbox"
										checked={workoutSelection.has(workout.id)}
										onChange={() => {
											void previewWorkoutRoute(workout.id);
											setWorkoutSelection((current) => {
												const next = new Set(current);
												if (next.has(workout.id)) next.delete(workout.id);
												else next.add(workout.id);
												return next;
											});
										}}
									/>
									<span>
										<strong>{workout.title ?? "Workout route"}</strong>
										<small>
											{new Date(workout.startedAt).toLocaleString()} ·{" "}
											{formatDistance(workout.distanceMeters)}
										</small>
									</span>
								</label>
							))}
							{previewWorkout && (
								<div className="workout-preview-map">
									<TripMap workouts={[previewWorkout]} media={[]} />
								</div>
							)}
						</div>
					)}
				</section>
				<section className="detail-section">
					<div className="detail-section-heading">
						<div>
							<p className="eyebrow">Library</p>
							<h2>Media</h2>
						</div>
					</div>
					<MediaBrowser
						tripId={tripId}
						workouts={detail.workoutsWithPoints}
						onChanged={() => void load()}
					/>
				</section>
			</div>
		</main>
	);
}

function formatDistance(meters: number | null) {
	return meters === null
		? "Distance unavailable"
		: `${(meters / 1609.344).toFixed(1)} mi`;
}
