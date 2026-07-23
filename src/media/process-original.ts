import { stat } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import {
	type CaptureTimeZoneSource,
	captureTimeFromVideoMetadata,
} from "./capture-time";
import { classifyMedia } from "./classify-media";
import { MediaPipelineError } from "./errors";
import { readPhotoCaptureMetadata } from "./read-capture-metadata";
import { runCommand } from "./run-command";
import type { MediaDerivativeKind, MediaKind } from "./types";

export const MEDIA_PROCESSING_VERSION = "media-v1";

export type ProcessedMedia = {
	kind: MediaKind;
	mimeType: string | null;
	width: number | null;
	height: number | null;
	durationMs: number | null;
	capturedAt: string | null;
	capturedAtLocal: string | null;
	capturedTimeZone: string | null;
	capturedTimeZoneSource: CaptureTimeZoneSource | null;
	latitude: number | null;
	longitude: number | null;
	metadata: Record<string, unknown>;
	derivatives: Array<{
		kind: MediaDerivativeKind;
		path: string;
		mimeType: string;
		width: number | null;
		height: number | null;
		durationMs: number | null;
		byteSize: number;
	}>;
};

export async function processMediaOriginal(input: {
	originalPath: string;
	derivedDirectory: string;
}): Promise<ProcessedMedia> {
	const kind = classifyMedia(input.originalPath);
	return kind === "photo"
		? processPhoto(input.originalPath, input.derivedDirectory)
		: processVideo(input.originalPath, input.derivedDirectory);
}

async function processPhoto(
	originalPath: string,
	derivedDirectory: string,
): Promise<ProcessedMedia> {
	const { metadata, ...captureTime } =
		await readPhotoCaptureMetadata(originalPath);
	let source: string | Uint8Array = originalPath;
	if (originalPath.toLowerCase().endsWith(".arw")) {
		source = await getRawSource(originalPath);
	}

	const outputs = [
		{ kind: "thumbnail" as const, edge: 384, quality: 74 },
		{ kind: "viewer" as const, edge: 2048, quality: 82 },
	];
	const derivatives: ProcessedMedia["derivatives"] = [];
	for (const output of outputs) {
		const path = join(inputDirectory(derivedDirectory), `${output.kind}.webp`);
		await sharp(source)
			.rotate()
			.toColourspace("srgb")
			.resize({
				width: output.edge,
				height: output.edge,
				fit: "inside",
				withoutEnlargement: true,
			})
			.webp({ quality: output.quality, effort: 4 })
			.toFile(path);
		derivatives.push(await validateImage(path, output.kind, output.edge));
	}
	return {
		kind: "photo",
		mimeType: stringValue(metadata.MIMEType),
		width: numberValue(metadata.ImageWidth),
		height: numberValue(metadata.ImageHeight),
		durationMs: null,
		...captureTime,
		latitude: numberValue(metadata.GPSLatitude),
		longitude: numberValue(metadata.GPSLongitude),
		metadata,
		derivatives,
	};
}

async function getRawSource(originalPath: string) {
	for (const field of ["-PreviewImage", "-JpgFromRaw"]) {
		try {
			const result = await runCommand(["exiftool", "-b", field, originalPath]);
			const metadata = await sharp(result.stdout).metadata();
			if (
				metadata.width &&
				metadata.height &&
				Math.max(metadata.width, metadata.height) >= 2048
			) {
				return result.stdout;
			}
		} catch {
			// Try the next embedded preview, then LibRaw.
		}
	}
	try {
		return (
			await runCommand(["dcraw_emu", "-c", "-w", "-q", "3", originalPath])
		).stdout;
	} catch (error) {
		throw new MediaPipelineError(
			"processing-failed",
			"The RAW image could not be decoded.",
			error instanceof Error ? error.message : String(error),
		);
	}
}

async function processVideo(
	originalPath: string,
	derivedDirectory: string,
): Promise<ProcessedMedia> {
	const probe = parseJson(
		(
			await runCommand([
				"ffprobe",
				"-v",
				"error",
				"-show_streams",
				"-show_format",
				"-of",
				"json",
				originalPath,
			])
		).stdout,
	);
	const streams = Array.isArray(probe.streams) ? probe.streams : [];
	const video = streams.find(
		(stream): stream is Record<string, unknown> =>
			typeof stream === "object" &&
			stream !== null &&
			stream.codec_type === "video",
	);
	if (!video)
		throw new MediaPipelineError(
			"inspection-failed",
			"No video stream was found.",
		);
	const format = objectValue(probe.format);
	const durationSeconds = Number(format.duration ?? video.duration);
	const durationMs = Number.isFinite(durationSeconds)
		? Math.round(durationSeconds * 1000)
		: null;
	const posterPng = join(inputDirectory(derivedDirectory), "poster.png");
	const posterPath = join(derivedDirectory, "poster.webp");
	const posterTime = Math.min(1, Math.max(0, (durationSeconds || 1) * 0.1));
	await runCommand([
		"ffmpeg",
		"-y",
		"-ss",
		String(posterTime),
		"-i",
		originalPath,
		"-frames:v",
		"1",
		"-an",
		posterPng,
	]);
	await sharp(posterPng)
		.rotate()
		.toColourspace("srgb")
		.resize({
			width: 960,
			height: 960,
			fit: "inside",
			withoutEnlargement: true,
		})
		.webp({ quality: 78, effort: 4 })
		.toFile(posterPath);
	await Bun.file(posterPng).delete();
	const proxyPath = join(derivedDirectory, "proxy.mp4");
	await runCommand([
		"ffmpeg",
		"-y",
		"-i",
		originalPath,
		"-map",
		"0:v:0",
		"-map",
		"0:a?",
		"-vf",
		"scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
		"-c:v",
		"libx264",
		"-preset",
		"medium",
		"-crf",
		"21",
		"-c:a",
		"aac",
		"-b:a",
		"160k",
		"-movflags",
		"+faststart",
		proxyPath,
	]);
	const poster = await validateImage(posterPath, "poster", 960);
	const proxy = await validateProxy(proxyPath, durationMs);
	const tags = objectValue(format.tags);
	const captureTime = captureTimeFromVideoMetadata(tags);
	return {
		kind: "video",
		mimeType: "video/mp4",
		width: numberValue(video.width),
		height: numberValue(video.height),
		durationMs,
		...captureTime,
		latitude: null,
		longitude: null,
		metadata: probe,
		derivatives: [poster, proxy],
	};
}

async function validateImage(
	path: string,
	kind: "thumbnail" | "viewer" | "poster",
	maxEdge: number,
): Promise<ProcessedMedia["derivatives"][number]> {
	const [file, metadata] = await Promise.all([
		stat(path),
		sharp(path).metadata(),
	]);
	if (
		file.size <= 0 ||
		metadata.format !== "webp" ||
		!metadata.width ||
		!metadata.height ||
		Math.max(metadata.width, metadata.height) > maxEdge
	) {
		throw new MediaPipelineError(
			"validation-failed",
			"A generated image was invalid.",
		);
	}
	return {
		kind,
		path,
		mimeType: "image/webp",
		width: metadata.width,
		height: metadata.height,
		durationMs: null,
		byteSize: file.size,
	};
}

async function validateProxy(
	path: string,
	durationMs: number | null,
): Promise<ProcessedMedia["derivatives"][number]> {
	const file = await stat(path);
	const probe = parseJson(
		(
			await runCommand([
				"ffprobe",
				"-v",
				"error",
				"-show_streams",
				"-of",
				"json",
				path,
			])
		).stdout,
	);
	const streams = Array.isArray(probe.streams) ? probe.streams : [];
	const video = streams.find(
		(stream): stream is Record<string, unknown> =>
			typeof stream === "object" &&
			stream !== null &&
			stream.codec_type === "video",
	);
	if (
		file.size <= 0 ||
		video?.codec_name !== "h264" ||
		video.pix_fmt !== "yuv420p" ||
		(numberValue(video.width) ?? Infinity) > 1920 ||
		(numberValue(video.height) ?? Infinity) > 1080
	) {
		throw new MediaPipelineError(
			"validation-failed",
			"The generated video proxy was invalid.",
		);
	}
	return {
		kind: "proxy",
		path,
		mimeType: "video/mp4",
		width: numberValue(video.width),
		height: numberValue(video.height),
		durationMs,
		byteSize: file.size,
	};
}

function inputDirectory(path: string) {
	return path;
}

function parseJson(bytes: Uint8Array): Record<string, unknown> {
	try {
		const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
		return objectValue(value);
	} catch (error) {
		throw new MediaPipelineError(
			"inspection-failed",
			"Media metadata was invalid.",
			String(error),
		);
	}
}

function objectValue(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: {};
}

function stringValue(value: unknown) {
	return typeof value === "string" ? value : null;
}

function numberValue(value: unknown) {
	const number = typeof value === "number" ? value : Number(value);
	return Number.isFinite(number) ? number : null;
}
