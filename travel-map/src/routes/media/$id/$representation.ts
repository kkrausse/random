import { stat } from "node:fs/promises";
import { createFileRoute } from "@tanstack/react-router";
import { createMaxPhotoDerivative } from "../../../media/process-original";
import { getLibrary } from "../../../server/library";

const derivativeRepresentations = new Set([
	"thumbnail",
	"viewer",
	"poster",
	"proxy",
]);

const maxPhotoJobs = new Map<string, Promise<void>>();

export const Route = createFileRoute("/media/$id/$representation")({
	server: {
		handlers: {
			GET: async ({
				params,
				request,
			}: {
				params: { id: string; representation: string };
				request: Request;
			}) => {
				const library = getLibrary();
				const media = library.repository.getMedia(params.id);
				if (!media) return new Response("Not found", { status: 404 });
				let relativePath: string;
				let mimeType: string;
				if (params.representation === "original") {
					relativePath = media.originalRelativePath;
					mimeType = media.originalMimeType ?? "application/octet-stream";
				} else if (params.representation === "max" && media.kind === "photo") {
					relativePath = `media/derived/${media.id}/max.webp`;
					mimeType = "image/webp";
					const outputPath = library.paths.asset(relativePath);
					const outputInfo = await stat(outputPath).catch(() => null);
					if (!outputInfo?.isFile()) {
						let job = maxPhotoJobs.get(media.id);
						if (!job) {
							job = createMaxPhotoDerivative(
								library.paths.asset(media.originalRelativePath),
								outputPath,
							).finally(() => maxPhotoJobs.delete(media.id));
							maxPhotoJobs.set(media.id, job);
						}
						try {
							await job;
						} catch {
							return new Response("Could not prepare full-resolution photo", {
								status: 500,
							});
						}
					}
				} else if (derivativeRepresentations.has(params.representation)) {
					const derivative = library.repository.getDerivative(
						params.id,
						params.representation,
					);
					if (!derivative) return new Response("Not found", { status: 404 });
					relativePath = derivative.relative_path;
					mimeType = derivative.mime_type;
				} else {
					return new Response("Not found", { status: 404 });
				}
				const path = library.paths.asset(relativePath);
				const file = Bun.file(path);
				const info = await stat(path).catch(() => null);
				if (!info?.isFile()) return new Response("Not found", { status: 404 });
				const range = request.headers.get("range");
				if (
					range &&
					(mimeType.startsWith("video/") ||
						params.representation === "original")
				) {
					const match = range.match(/^bytes=(\d+)-(\d*)$/);
					if (!match) return new Response(null, { status: 416 });
					const start = Number(match[1]);
					const end = match[2]
						? Math.min(Number(match[2]), info.size - 1)
						: info.size - 1;
					if (start > end || start >= info.size)
						return new Response(null, { status: 416 });
					return new Response(file.slice(start, end + 1), {
						status: 206,
						headers: {
							"Accept-Ranges": "bytes",
							"Content-Range": `bytes ${start}-${end}/${info.size}`,
							"Content-Length": String(end - start + 1),
							"Content-Type": mimeType,
						},
					});
				}
				const headers: Record<string, string> = {
					"Content-Type": mimeType,
					"Content-Length": String(info.size),
					"Accept-Ranges": "bytes",
				};
				if (params.representation === "original")
					headers["Content-Disposition"] =
						`attachment; filename="${safeFilename(media.originalFilename)}"`;
				return new Response(file, { headers });
			},
		},
	},
});

function safeFilename(filename: string) {
	return filename.replace(/["\r\n]/g, "_");
}
