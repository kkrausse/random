import { createFileRoute } from "@tanstack/react-router";
import { ingestUploadedMedia } from "../../../media/ingest";
import { getLibrary } from "../../../server/library";

export const Route = createFileRoute("/api/media/upload")({
	server: {
		handlers: {
			POST: async ({ request }: { request: Request }) => {
				const form = await request.formData();
				const file = form.get("file");
				const importId = form.get("importId");
				const sourceKey = form.get("sourceKey");
				if (
					!(file instanceof File) ||
					typeof importId !== "string" ||
					typeof sourceKey !== "string"
				) {
					return Response.json(
						{ error: "file, importId, and sourceKey are required." },
						{ status: 400 },
					);
				}
				const library = getLibrary();
				let item = library.repository.getImportItemBySource(
					importId,
					sourceKey,
				);
				if (!item) {
					item = library.repository.createImportItem({
						importId,
						sourceKey,
						entityType: "media",
						originalFilename: file.name,
					});
				}
				const media = await ingestUploadedMedia({
					file,
					importId,
					importItemId: item.id,
					context: {
						repository: library.repository,
						assetRoot: library.config.ASSET_ROOT,
						tempRoot:
							library.config.ASSET_TEMP_ROOT ??
							`${library.config.ASSET_ROOT}/.tmp`,
					},
				});
				const items = library.repository.listImportItems(importId);
				if (
					items.every(
						(value) =>
							value.status === "completed" || value.status === "failed",
					)
				) {
					library.repository.updateImportStatus(
						importId,
						items.some((value) => value.status === "failed")
							? "completed-with-errors"
							: "completed",
					);
				}
				return Response.json({
					media,
					item: library.repository.getImportItem(item.id),
				});
			},
		},
	},
});
