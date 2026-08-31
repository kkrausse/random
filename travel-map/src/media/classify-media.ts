import { extname } from "node:path";
import { UnsupportedMediaError } from "./errors";
import type { MediaKind } from "./types";

export const PHOTO_EXTENSIONS = [
	".arw",
	".jpg",
	".jpeg",
	".png",
	".heic",
	".heif",
	".webp",
	".tif",
	".tiff",
] as const;
export const VIDEO_EXTENSIONS = [".mp4", ".mov", ".m4v"] as const;
export const SUPPORTED_MEDIA_EXTENSIONS = [
	...PHOTO_EXTENSIONS,
	...VIDEO_EXTENSIONS,
] as const;

export function classifyMedia(path: string): MediaKind {
	const extension = extname(path).toLowerCase();
	if ((PHOTO_EXTENSIONS as readonly string[]).includes(extension))
		return "photo";
	if ((VIDEO_EXTENSIONS as readonly string[]).includes(extension))
		return "video";
	throw new UnsupportedMediaError();
}
