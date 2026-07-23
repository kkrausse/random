import { createFileRoute } from "@tanstack/react-router";
import { getLibrary } from "../../../server/library";

export const Route = createFileRoute("/api/media/imports")({
	server: {
		handlers: {
			POST: async ({ request }: { request: Request }) => {
				const body = (await request.json()) as {
					sourceName?: string;
					items?: Array<{ sourceKey: string; filename: string }>;
				};
				const repository = getLibrary().repository;
				const record = getLibrary().repository.createImport({
					kind: "media",
					sourceType: "browser",
					sourceName: body.sourceName?.trim() || "Browser upload",
				});
				for (const item of body.items ?? []) {
					repository.createImportItem({
						importId: record.id,
						sourceKey: item.sourceKey,
						entityType: "media",
						originalFilename: item.filename,
					});
				}
				return Response.json(record, { status: 201 });
			},
		},
	},
});
