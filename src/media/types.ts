export type MediaStatus = "processing" | "ready" | "failed";
export type MediaKind = "photo" | "video";
export type MediaDerivativeKind = "thumbnail" | "viewer" | "poster" | "proxy";

export type MediaBrowserItem = {
	id: string;
	kind: MediaKind;
	status: "ready";
	effectiveCapturedAt: string | null;
	latitude: number | null;
	longitude: number | null;
	width: number | null;
	height: number | null;
	durationMs: number | null;
	previewUrl: string;
	isInCurrentTrip: boolean;
};

export type WorkoutPoint = {
	recordedAt: string;
	latitude: number;
	longitude: number;
	elevationMeters?: number | null;
};

export type WorkoutWithPoints = {
	id: string;
	startedAt: string;
	endedAt: string;
	points: WorkoutPoint[];
};

export type ResolvedMediaPosition = {
	latitude: number;
	longitude: number;
	source: "gps" | "workout";
	workoutId?: string;
};
