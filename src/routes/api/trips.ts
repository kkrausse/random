import { createFileRoute } from "@tanstack/react-router";
import { getLibrary } from "../../server/library";

export const Route = createFileRoute("/api/trips")({
	server: {
		handlers: {
			GET: () => Response.json(getLibrary().repository.listTrips()),
			POST: async ({ request }: { request: Request }) => {
				const body = (await request.json()) as { title?: unknown };
				if (typeof body.title !== "string" || !body.title.trim()) {
					return Response.json(
						{ error: "Title is required." },
						{ status: 400 },
					);
				}
				return Response.json(getLibrary().repository.createTrip(body.title), {
					status: 201,
				});
			},
		},
	},
});
