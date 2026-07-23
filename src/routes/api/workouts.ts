import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createFileRoute } from "@tanstack/react-router";
import JSZip from "jszip";
import { getLibrary } from "../../server/library";
import { importAssetKey, workoutRouteKey } from "../../storage/paths";
import { parseGpxWorkout } from "../../workouts/parse-gpx";

export const Route = createFileRoute("/api/workouts")({
	server: {
		handlers: {
			GET: ({ request }: { request: Request }) => {
				const url = new URL(request.url);
				const workoutId = url.searchParams.get("id");
				if (workoutId) {
					const workout =
						getLibrary().repository.getWorkoutWithPoints(workoutId);
					return workout
						? Response.json(workout)
						: Response.json({ error: "Workout not found." }, { status: 404 });
				}
				return Response.json(
					getLibrary().repository.listWorkouts({
						unassigned: url.searchParams.get("unassigned") === "true",
						query: url.searchParams.get("query") ?? undefined,
						importId: url.searchParams.get("importId") ?? undefined,
					}),
				);
			},
			POST: async ({ request }: { request: Request }) => {
				const form = await request.formData();
				const file = form.get("file");
				if (!(file instanceof File))
					return Response.json(
						{ error: "A workout archive is required." },
						{ status: 400 },
					);
				const library = getLibrary();
				const record = library.repository.createImport({
					kind: "workout",
					sourceType: "workout-archive",
					sourceName: file.name,
				});
				const archiveKey = importAssetKey(
					record.id,
					`original${extension(file.name) || ".zip"}`,
				);
				const archivePath = library.paths.asset(archiveKey);
				await mkdir(dirname(archivePath), { recursive: true });
				await Bun.write(archivePath, file);
				library.repository.db
					.query("UPDATE imports SET original_relative_path = ? WHERE id = ?")
					.run(archiveKey, record.id);
				let zip: JSZip;
				try {
					// JSZip does not recognize BunFile, but does accept its ArrayBuffer bytes.
					zip = await JSZip.loadAsync(
						await Bun.file(archivePath).arrayBuffer(),
					);
				} catch {
					library.repository.updateImportStatus(
						record.id,
						"failed",
						"The workout archive could not be opened.",
					);
					return Response.json(
						{ error: "The workout archive could not be opened." },
						{ status: 400 },
					);
				}
				const entries = Object.values(zip.files)
					.filter(
						(entry) =>
							!entry.dir &&
							/(?:^|\/)workout-routes\/.*\.gpx$/i.test(entry.name),
					)
					.sort((a, b) => a.name.localeCompare(b.name));
				let failed = 0;
				for (const entry of entries) {
					const item = library.repository.createImportItem({
						importId: record.id,
						sourceKey: entry.name,
						entityType: "workout",
						originalFilename: entry.name.split("/").at(-1) ?? "route.gpx",
					});
					library.repository.setImportItemStatus(item.id, "processing");
					try {
						const xml = await entry.async("text");
						const workout = parseGpxWorkout(xml);
						const workoutId = crypto.randomUUID();
						const routeKey = workoutRouteKey(workoutId);
						const routePath = library.paths.asset(routeKey);
						await mkdir(dirname(routePath), { recursive: true });
						await Bun.write(routePath, xml);
						await Bun.write(
							library.paths.asset(`workouts/${workoutId}/metadata.json`),
							JSON.stringify(workout, null, 2),
						);
						library.repository.createWorkout({
							id: workoutId,
							importId: record.id,
							title: workout.title,
							startedAt: workout.startedAt,
							endedAt: workout.endedAt,
							activityType: null,
							distanceMeters: workout.distanceMeters,
							originalRelativePath: routeKey,
							points: workout.points,
						});
						library.repository.setImportItemStatus(item.id, "completed", {
							entityId: workoutId,
						});
					} catch {
						failed += 1;
						library.repository.setImportItemStatus(item.id, "failed", {
							errorMessage: "This workout route could not be parsed.",
						});
					}
				}
				library.repository.updateImportStatus(
					record.id,
					entries.length === 0
						? "failed"
						: failed > 0
							? "completed-with-errors"
							: "completed",
					entries.length === 0 ? "No GPX workout routes were found." : null,
				);
				return Response.json(
					{ importId: record.id, ready: entries.length - failed, failed },
					{ status: 201 },
				);
			},
		},
	},
});

function extension(filename: string) {
	const index = filename.lastIndexOf(".");
	return index >= 0 ? filename.slice(index).toLowerCase() : "";
}
