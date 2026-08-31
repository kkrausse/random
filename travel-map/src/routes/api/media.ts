import { createFileRoute } from "@tanstack/react-router";
import { getLibrary } from "../../server/library";

export const Route = createFileRoute("/api/media")({
	server: {
		handlers: {
			GET: ({ request }: { request: Request }) => {
				const url = new URL(request.url);
				const tripId = url.searchParams.get("tripId") ?? undefined;
				const kindValue = url.searchParams.get("kind");
				const kind =
					kindValue === "photo" || kindValue === "video"
						? kindValue
						: undefined;
				return Response.json(getLibrary().repository.listMedia(tripId, kind));
			},
		},
	},
});
