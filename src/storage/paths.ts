import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { AppConfig } from "../config";

export type MediaDerivative =
	| "thumbnail.webp"
	| "viewer.webp"
	| "poster.webp"
	| "proxy.mp4";

function assertPathSegment(value: string, label: string): void {
	if (
		!value ||
		value === "." ||
		value === ".." ||
		value.includes("/") ||
		value.includes("\\") ||
		value.includes("\0")
	) {
		throw new Error(`${label} must be a single safe path segment`);
	}
}

/** Resolve a persisted asset key while guaranteeing it remains below root. */
export function resolveRelativePath(root: string, assetKey: string): string {
	if (!assetKey || isAbsolute(assetKey) || assetKey.includes("\0")) {
		throw new Error("Asset path must be a non-empty relative path");
	}

	// Persisted keys always use POSIX separators, including on Windows.
	const segments = assetKey.split("/");
	if (
		segments.some(
			(segment) =>
				!segment ||
				segment === "." ||
				segment === ".." ||
				segment.includes("\\"),
		)
	) {
		throw new Error("Asset path contains an unsafe segment");
	}

	const absoluteRoot = resolve(root);
	const candidate = resolve(absoluteRoot, ...segments);
	const fromRoot = relative(absoluteRoot, candidate);
	if (
		fromRoot === ".." ||
		fromRoot.startsWith(`..${sep}`) ||
		isAbsolute(fromRoot)
	) {
		throw new Error("Asset path escapes the configured root");
	}

	return candidate;
}

export function originalMediaKey(
	mediaId: string,
	originalFilename: string,
): string {
	assertPathSegment(mediaId, "Media id");
	const extension = extname(originalFilename);
	if (!extension || extension.includes("/") || extension.includes("\\")) {
		throw new Error("Original filename must have a safe extension");
	}

	return `media/originals/${mediaId}/original${extension.toLowerCase()}`;
}

export function derivedMediaKey(
	mediaId: string,
	derivative: MediaDerivative,
): string {
	assertPathSegment(mediaId, "Media id");
	return `media/derived/${mediaId}/${derivative}`;
}

export function importAssetKey(importId: string, filename: string): string {
	assertPathSegment(importId, "Import id");
	assertPathSegment(filename, "Import filename");
	return `imports/${importId}/${filename}`;
}

export function workoutRouteKey(workoutId: string): string {
	assertPathSegment(workoutId, "Workout id");
	return `workouts/${workoutId}/route.gpx`;
}

export interface AssetPaths {
	asset(assetKey: string): string;
	temporary(assetKey: string): string;
	mediaOriginal(mediaId: string, originalFilename: string): string;
	mediaDerivative(mediaId: string, derivative: MediaDerivative): string;
}

export function createAssetPaths(config: AppConfig): AssetPaths {
	return {
		asset: (assetKey) => resolveRelativePath(config.ASSET_ROOT, assetKey),
		temporary: (assetKey) =>
			resolveRelativePath(
				config.ASSET_TEMP_ROOT ?? config.ASSET_ROOT,
				assetKey,
			),
		mediaOriginal: (mediaId, originalFilename) =>
			resolveRelativePath(
				config.ASSET_ROOT,
				originalMediaKey(mediaId, originalFilename),
			),
		mediaDerivative: (mediaId, derivative) =>
			resolveRelativePath(
				config.ASSET_ROOT,
				derivedMediaKey(mediaId, derivative),
			),
	};
}
