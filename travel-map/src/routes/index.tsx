import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, MapPinned, Plus } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";
import { Button } from "../components/ui/button";
import type { TripRecord } from "../db/library";

export const Route = createFileRoute("/")({ component: TripsIndex });

function TripsIndex() {
	const [trips, setTrips] = useState<TripRecord[]>([]);
	const [showForm, setShowForm] = useState(false);
	const [title, setTitle] = useState("");
	const [error, setError] = useState<string>();
	const navigate = useNavigate();
	const loadEvent = useEffectEvent(() => void loadTrips());
	useEffect(() => loadEvent(), []);

	async function loadTrips() {
		const response = await fetch("/api/trips");
		if (response.ok) setTrips(await response.json());
		else
			setError(
				"Trips could not be loaded. Check local database configuration.",
			);
	}

	async function createTrip(event: React.FormEvent) {
		event.preventDefault();
		const response = await fetch("/api/trips", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title }),
		});
		const result = (await response.json()) as TripRecord & { error?: string };
		if (!response.ok) {
			setError(result.error ?? "Trip could not be created.");
			return;
		}
		await navigate({ to: "/trips/$tripId", params: { tripId: result.id } });
	}

	return (
		<main className="trips-page">
			<header className="page-header">
				<div>
					<p className="eyebrow">
						<MapPinned size={14} /> Personal atlas
					</p>
					<h1>Trips</h1>
					<p>Build a place from routes, photographs, and video.</p>
				</div>
				<Button onClick={() => setShowForm(true)}>
					<Plus size={16} /> Add trip
				</Button>
			</header>
			{showForm && (
				<form className="new-trip" onSubmit={(event) => void createTrip(event)}>
					<label>
						Title
						<input
							value={title}
							onChange={(event) => setTitle(event.target.value)}
							placeholder="A short name is enough"
						/>
					</label>
					<div>
						<Button
							type="button"
							variant="ghost"
							onClick={() => setShowForm(false)}
						>
							Cancel
						</Button>
						<Button type="submit">Create trip</Button>
					</div>
				</form>
			)}
			{error && <p className="inline-error">{error}</p>}
			<section className="trip-list" aria-label="Trips">
				{trips.map((trip, index) => (
					<Link
						className="trip-card"
						key={trip.id}
						to="/trips/$tripId"
						params={{ tripId: trip.id }}
					>
						<span className="trip-number">
							{String(index + 1).padStart(2, "0")}
						</span>
						<div>
							<h2>{trip.title}</h2>
							<p>Updated {new Date(trip.updatedAt).toLocaleDateString()}</p>
						</div>
						<ArrowRight size={18} />
					</Link>
				))}
				{trips.length === 0 && !error && (
					<div className="empty-trips">
						<MapPinned size={30} />
						<h2>No trips yet</h2>
						<p>
							Create a trip, then add imported workouts and media from your
							library.
						</p>
					</div>
				)}
			</section>
		</main>
	);
}
