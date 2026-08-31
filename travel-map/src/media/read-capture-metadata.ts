import {
	type CaptureTime,
	captureTimeFromPhotoMetadata,
	captureTimeFromVideoMetadata,
} from "./capture-time";
import { runCommand } from "./run-command";
import type { MediaKind } from "./types";

export type CaptureMetadata = CaptureTime & {
	metadata: Record<string, unknown>;
};

export async function readCaptureMetadata(
	path: string,
	kind: MediaKind,
): Promise<CaptureMetadata> {
	return kind === "photo"
		? readPhotoCaptureMetadata(path)
		: readVideoCaptureMetadata(path);
}

export async function readPhotoCaptureMetadata(
	path: string,
): Promise<CaptureMetadata> {
	const result = await runCommand([
		"exiftool",
		"-json",
		"-n",
		"-MIMEType",
		"-ImageWidth",
		"-ImageHeight",
		"-Orientation",
		"-SubSecDateTimeOriginal",
		"-DateTimeOriginal",
		"-OffsetTimeOriginal",
		"-SubSecCreateDate",
		"-CreateDate",
		"-OffsetTimeDigitized",
		"-GPSDateTime",
		"-GPSLatitude",
		"-GPSLongitude",
		"-TimeZone",
		"-DaylightSavings",
		"-Make",
		"-Model",
		"-LensModel",
		path,
	]);
	const metadata = parseJsonArray(result.stdout)[0] ?? {};
	return { ...captureTimeFromPhotoMetadata(metadata), metadata };
}

async function readVideoCaptureMetadata(
	path: string,
): Promise<CaptureMetadata> {
	const result = await runCommand([
		"ffprobe",
		"-v",
		"error",
		"-show_format",
		"-of",
		"json",
		path,
	]);
	const metadata = parseJson(result.stdout);
	const format = objectValue(metadata.format);
	return {
		...captureTimeFromVideoMetadata(objectValue(format.tags)),
		metadata,
	};
}

function parseJson(bytes: Uint8Array): Record<string, unknown> {
	const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
	return objectValue(value);
}

function parseJsonArray(bytes: Uint8Array): Record<string, unknown>[] {
	const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
	return Array.isArray(value) ? value.map(objectValue) : [];
}

function objectValue(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: {};
}
