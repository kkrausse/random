import { createFileRoute } from "@tanstack/react-router";
import type JSZip from "jszip";
import {
	Activity,
	Archive,
	ChevronRight,
	LoaderCircle,
	MapPinned,
	Route as RouteIcon,
	Search,
	Upload,
} from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { RouteMap } from "@/components/route-map";
import { Button } from "@/components/ui/button";
import {
	formatDistance,
	formatDuration,
	listWorkoutRoutes,
	openAppleHealthExport,
	type RouteSummary,
	readWorkoutRoute,
	type WorkoutRoute,
} from "@/lib/apple-health";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	const [routes, setRoutes] = useState<RouteSummary[]>([]);
	const [selectedId, setSelectedId] = useState<string>();
	const [workout, setWorkout] = useState<WorkoutRoute>();
	const [isLoadingExport, setIsLoadingExport] = useState(true);
	const [isLoadingRoute, setIsLoadingRoute] = useState(false);
	const [error, setError] = useState<string>();
	const [query, setQuery] = useState("");
	const [sourceName, setSourceName] = useState("Example export");
	const archiveRef = useRef<JSZip>();
	const routeCache = useRef(new Map<string, WorkoutRoute>());
	const requestVersion = useRef(0);
	const uploadRef = useRef<HTMLInputElement>(null);
	const loadBundledExport = useEffectEvent(() => {
		void loadExport();
	});

	useEffect(() => {
		loadBundledExport();
	}, []);

	async function loadExport(file?: File) {
		setIsLoadingExport(true);
		setError(undefined);
		setRoutes([]);
		setWorkout(undefined);
		setSelectedId(undefined);
		routeCache.current.clear();

		try {
			const exportFile = file ?? (await fetch("/export.zip")).blob();
			const archive = await openAppleHealthExport(await exportFile);
			const availableRoutes = listWorkoutRoutes(archive);
			if (availableRoutes.length === 0)
				throw new Error("No GPX workout routes were found in this export.");

			archiveRef.current = archive;
			setRoutes(availableRoutes);
			setSourceName(file?.name ?? "Example export");
			void selectRoute(availableRoutes[0], archive);
		} catch (loadError) {
			setError(
				loadError instanceof Error
					? loadError.message
					: "The Apple Health export could not be opened.",
			);
		} finally {
			setIsLoadingExport(false);
		}
	}

	async function selectRoute(
		route: RouteSummary,
		archive = archiveRef.current,
	) {
		if (!archive) return;
		const version = ++requestVersion.current;
		setSelectedId(route.id);
		setWorkout(undefined);
		setIsLoadingRoute(true);
		setError(undefined);

		try {
			const cachedRoute = routeCache.current.get(route.id);
			const parsedRoute =
				cachedRoute ?? (await readWorkoutRoute(archive, route));
			routeCache.current.set(route.id, parsedRoute);
			if (version === requestVersion.current) setWorkout(parsedRoute);
		} catch (routeError) {
			if (version === requestVersion.current) {
				setWorkout(undefined);
				setError(
					routeError instanceof Error
						? routeError.message
						: "This workout route could not be opened.",
				);
			}
		} finally {
			if (version === requestVersion.current) setIsLoadingRoute(false);
		}
	}

	const visibleRoutes = routes.filter((route) =>
		route.label.toLowerCase().includes(query.trim().toLowerCase()),
	);
	const selectedSummary = routes.find((route) => route.id === selectedId);

	return (
		<main className="app-shell">
			<aside className="sidebar">
				<header className="sidebar-header">
					<div className="eyebrow">
						<Activity size={14} /> Apple Health
					</div>
					<h1>Routes</h1>
					<p>Every recorded path, held locally.</p>
				</header>

				<section className="source-card" aria-label="Export source">
					<div className="source-icon">
						<Archive size={18} />
					</div>
					<div>
						<strong>{sourceName}</strong>
						<span>
							{isLoadingExport
								? "Opening archive..."
								: `${routes.length.toLocaleString()} workout routes`}
						</span>
					</div>
				</section>

				<input
					ref={uploadRef}
					className="sr-only"
					type="file"
					accept=".zip,application/zip,application/x-zip-compressed"
					onChange={(event) => {
						const file = event.target.files?.[0];
						if (file) void loadExport(file);
						event.target.value = "";
					}}
				/>
				<Button
					className="upload-button"
					variant="outline"
					onClick={() => uploadRef.current?.click()}
				>
					<Upload size={15} /> Open another export
				</Button>

				<div className="route-list-heading">
					<span>Workout routes</span>
					<b>{visibleRoutes.length}</b>
				</div>
				<label className="search-field">
					<Search size={15} />
					<input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search by date"
					/>
				</label>
				{(isLoadingRoute || selectedSummary) && (
					<section className="sidebar-route-detail" aria-label="Selected route">
						<div className="sidebar-route-heading">
							<div>
								<p className="eyebrow">Workout route</p>
								<h2>{workout?.label ?? selectedSummary?.label}</h2>
							</div>
							{isLoadingRoute && <LoaderCircle className="spin" size={18} />}
						</div>
						{workout && !isLoadingRoute && (
							<div className="route-stats">
								<span>
									<b>{formatDistance(workout.distanceMeters)}</b>distance
								</span>
								<span>
									<b>{formatDuration(workout.durationSeconds)}</b>duration
								</span>
								<span>
									<b>{workout.points.length.toLocaleString()}</b>points
								</span>
							</div>
						)}
					</section>
				)}

				<div className="route-list">
					{isLoadingExport && <LoadingMessage label="Reading workout routes" />}
					{!isLoadingExport &&
						visibleRoutes.map((route) => (
							<button
								className={`route-card ${route.id === selectedId ? "is-selected" : ""}`}
								key={route.id}
								type="button"
								onClick={() => void selectRoute(route)}
							>
								<span className="route-marker">
									<RouteIcon size={15} />
								</span>
								<span className="route-card-content">
									<strong>{route.label}</strong>
									<small>Recorded route</small>
								</span>
								<ChevronRight size={16} />
							</button>
						))}
					{!isLoadingExport && visibleRoutes.length === 0 && (
						<p className="empty-list">No routes match that date.</p>
					)}
				</div>
			</aside>

			<section className="map-panel">
				<RouteMap route={workout} />
				<div className="map-topbar">
					<div className="map-brand">
						<MapPinned size={18} />
						<span>Personal atlas</span>
					</div>
					<span className="privacy-note">Processed in your browser</span>
				</div>
				{!isLoadingExport && !selectedSummary && !error && (
					<div className="map-empty">
						<MapPinned size={26} />
						<strong>Select a route</strong>
						<span>Choose a workout from the list to see its path.</span>
					</div>
				)}
				{error && (
					<div className="map-error">
						<strong>Could not open export</strong>
						<span>{error}</span>
					</div>
				)}
			</section>
		</main>
	);
}

function LoadingMessage({ label }: { label: string }) {
	return (
		<div className="loading-message">
			<LoaderCircle className="spin" size={18} /> {label}
		</div>
	);
}
