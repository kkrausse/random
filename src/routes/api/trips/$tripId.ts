import { createFileRoute } from "@tanstack/react-router";
import { getLibrary } from "../../../server/library";

export const Route = createFileRoute("/api/trips/$tripId")({
	server: {
		handlers: {
			GET: ({ params }: { params: { tripId: string } }) => {
				const repository = getLibrary().repository;
				const trip = repository.getTrip(params.tripId);
				if (!trip)
					return Response.json({ error: "Trip not found." }, { status: 404 });
				return Response.json({
					trip,
					media: repository.listMedia(params.tripId),
					workouts: repository.listWorkouts({ tripId: params.tripId }),
					workoutsWithPoints: repository.getWorkoutsForTripWithPoints(
						params.tripId,
					),
				});
			},
			PATCH: async ({
				params,
				request,
			}: {
				params: { tripId: string };
				request: Request;
			}) => {
				const repository = getLibrary().repository;
				const body = (await request.json()) as {
					title?: string;
					attachMediaIds?: string[];
					detachMediaId?: string;
					assignWorkoutIds?: string[];
					mediaTimestamp?: { id: string; value: string | null };
					shiftMediaTimestamps?: { ids: string[]; offsetMinutes: number };
				};
				if (body.title !== undefined)
					repository.updateTrip(params.tripId, body.title);
				if (body.attachMediaIds)
					repository.attachMediaToTrip(params.tripId, body.attachMediaIds);
				if (body.detachMediaId)
					repository.detachMediaFromTrip(params.tripId, body.detachMediaId);
				if (body.assignWorkoutIds)
					repository.assignWorkoutsToTrip(params.tripId, body.assignWorkoutIds);
				if (body.mediaTimestamp)
					repository.updateMediaTimestampOverride(
						body.mediaTimestamp.id,
						body.mediaTimestamp.value,
					);
				let shifted: number | undefined;
				if (body.shiftMediaTimestamps) {
					const { ids, offsetMinutes } = body.shiftMediaTimestamps;
					if (!Array.isArray(ids) || !Number.isFinite(offsetMinutes)) {
						return Response.json(
							{ error: "Invalid media time shift." },
							{ status: 400 },
						);
					}
					shifted = repository.shiftMediaTimestampOverrides(ids, offsetMinutes);
				}
				return Response.json({ ok: true, shifted });
			},
		},
	},
});
