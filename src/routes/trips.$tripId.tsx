import { createFileRoute, Link } from "@tanstack/react-router";
import {
	Archive,
	ArrowLeft,
	Check,
	ChevronRight,
	Dumbbell,
	MapPinned,
	Search,
	Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MediaBrowser } from "../components/media-browser";
import { TripMap } from "../components/trip-map";
import { Button } from "../components/ui/button";
import type { ImportRecord, TripRecord, WorkoutListItem } from "../db/library";
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
	const [workoutImports, setWorkoutImports] = useState<ImportRecord[]>([]);
	const [selectedImportId, setSelectedImportId] = useState<string>();
	const [workoutSelection, setWorkoutSelection] = useState<Set<string>>(
		new Set(),
	);
	const [previewWorkout, setPreviewWorkout] = useState<WorkoutWithPoints>();
	const [query, setQuery] = useState("");
	const [showWorkouts, setShowWorkouts] = useState(false);
	const [selectedMedia, setSelectedMedia] = useState<MediaBrowserItem[]>([]);
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

	async function openWorkoutSelector() {
		const response = await fetch("/api/media/imports?kind=workout");
		if (response.ok) setWorkoutImports(await response.json());
		setSelectedImportId(undefined);
		setUnassigned([]);
		setWorkoutSelection(new Set());
		setPreviewWorkout(undefined);
		setQuery("");
		setShowWorkouts(true);
	}

	async function findWorkouts(importId: string, search = query) {
		const params = new URLSearchParams({
			unassigned: "true",
			query: search,
			importId,
		});
		const response = await fetch(`/api/workouts?${params}`);
		if (response.ok) setUnassigned(await response.json());
	}

	function selectImport(importId: string) {
		setSelectedImportId(importId);
		setWorkoutSelection(new Set());
		setPreviewWorkout(undefined);
		setQuery("");
		void findWorkouts(importId, "");
	}

	async function uploadWorkout(file: File) {
		const form = new FormData();
		form.set("file", file);
		const response = await fetch("/api/workouts", {
			method: "POST",
			body: form,
		});
		if (!response.ok) return;
		const result: { importId: string } = await response.json();
		const importsResponse = await fetch("/api/media/imports?kind=workout");
		if (importsResponse.ok) setWorkoutImports(await importsResponse.json());
		setShowWorkouts(true);
		selectImport(result.importId);
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
	const assignedMedia = detail.media.filter((item) => item.isInCurrentTrip);
	const assignedMediaIds = new Set(assignedMedia.map((item) => item.id));
	const mapMedia = [
		...assignedMedia,
		...selectedMedia.filter((item) => !assignedMediaIds.has(item.id)),
	];
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
				<TripMap workouts={detail.workoutsWithPoints} media={mapMedia} />
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
							<Button onClick={() => void openWorkoutSelector()}>
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
							<header className="workout-selector-header">
								<div>
									<p className="eyebrow">Add workouts</p>
									<h3>
										{selectedImportId ? "Choose workouts" : "Choose an import"}
									</h3>
								</div>
								<Button variant="ghost" onClick={() => setShowWorkouts(false)}>
									Close
								</Button>
							</header>
							{!selectedImportId ? (
								<div className="workout-import-list">
									{workoutImports.map((item) => (
										<button
											key={item.id}
											type="button"
											onClick={() => selectImport(item.id)}
										>
											<span className="workout-import-icon">
												<Archive size={17} />
											</span>
											<span>
												<strong>{item.sourceName}</strong>
												<small>
													{new Date(item.createdAt).toLocaleString()} ·{" "}
													{formatImportStatus(item.status)}
												</small>
											</span>
											<ChevronRight size={16} />
										</button>
									))}
									{workoutImports.length === 0 && (
										<p className="section-empty">
											No workout imports yet. Upload an Apple Health export
											first.
										</p>
									)}
								</div>
							) : (
								<>
									<div className="selector-toolbar">
										<Button
											variant="ghost"
											onClick={() => {
												setSelectedImportId(undefined);
												setPreviewWorkout(undefined);
											}}
										>
											← Imports
										</Button>
										<label className="selector-search">
											<Search size={14} />
											<input
												value={query}
												placeholder="Search title or activity"
												onChange={(event) => {
													setQuery(event.target.value);
													void findWorkouts(
														selectedImportId,
														event.target.value,
													);
												}}
											/>
										</label>
										<Button
											disabled={!workoutSelection.size}
											onClick={() => void assignWorkouts()}
										>
											<Check size={14} /> Add selected
										</Button>
									</div>
									<div className="workout-browser">
										<div className="workout-route-list">
											{unassigned.map((workout) => (
												<div
													className={
														previewWorkout?.id === workout.id
															? "is-previewed"
															: ""
													}
													key={workout.id}
												>
													<input
														type="checkbox"
														aria-label={`Select ${workout.title ?? "workout route"}`}
														checked={workoutSelection.has(workout.id)}
														onChange={() =>
															setWorkoutSelection((current) => {
																const next = new Set(current);
																if (next.has(workout.id))
																	next.delete(workout.id);
																else next.add(workout.id);
																return next;
															})
														}
													/>
													<button
														type="button"
														onClick={() => void previewWorkoutRoute(workout.id)}
													>
														<strong>{workout.title ?? "Workout route"}</strong>
														<small>
															{new Date(workout.startedAt).toLocaleString()} ·{" "}
															{formatDistance(workout.distanceMeters)}
														</small>
													</button>
												</div>
											))}
											{unassigned.length === 0 && (
												<p className="section-empty">
													No unassigned workouts in this import.
												</p>
											)}
										</div>
										<div className="workout-preview-map">
											{previewWorkout ? (
												<TripMap workouts={[previewWorkout]} media={[]} />
											) : (
												<div className="workout-preview-empty">
													<MapPinned size={24} />
													<strong>Select a workout</strong>
													<span>Click a route to preview its outline.</span>
												</div>
											)}
										</div>
									</div>
								</>
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
						onChanged={() => void load()}
						onSelectionChange={setSelectedMedia}
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

function formatImportStatus(status: ImportRecord["status"]) {
	return status.replaceAll("-", " ");
}
