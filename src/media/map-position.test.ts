import { describe, expect, it } from "vitest";
import {
	interpolateWorkoutPosition,
	resolveMediaMapPosition,
} from "./map-position";
import type { MediaBrowserItem, WorkoutWithPoints } from "./types";

const workout: WorkoutWithPoints = {
	id: "workout",
	startedAt: "2025-01-01T00:00:00Z",
	endedAt: "2025-01-01T00:10:00Z",
	points: [
		{ recordedAt: "2025-01-01T00:00:00Z", latitude: 0, longitude: 10 },
		{ recordedAt: "2025-01-01T00:10:00Z", latitude: 10, longitude: 20 },
	],
};

describe("interpolateWorkoutPosition", () => {
	it("returns exact and midpoint positions", () => {
		expect(
			interpolateWorkoutPosition(workout.points, new Date(workout.startedAt)),
		).toEqual({
			latitude: 0,
			longitude: 10,
		});
		expect(
			interpolateWorkoutPosition(
				workout.points,
				new Date("2025-01-01T00:05:00Z"),
			),
		).toEqual({ latitude: 5, longitude: 15 });
	});

	it("does not extrapolate or cross a large point gap", () => {
		expect(
			interpolateWorkoutPosition(
				workout.points,
				new Date("2024-12-31T23:59:00Z"),
			),
		).toBeNull();
		expect(
			interpolateWorkoutPosition(
				workout.points,
				new Date("2025-01-01T00:11:00Z"),
			),
		).toBeNull();
		const points = [
			workout.points[0],
			{
				recordedAt: "2025-01-01T00:10:00.001Z",
				latitude: 10,
				longitude: 20,
			},
		];
		expect(
			interpolateWorkoutPosition(points, new Date("2025-01-01T00:05:00Z")),
		).toBeNull();
	});
});

it("uses effective capture time on a matching workout before GPS", () => {
	const media: MediaBrowserItem = {
		id: "media",
		kind: "photo",
		status: "ready",
		effectiveCapturedAt: "2025-01-01T00:05:00Z",
		latitude: 40,
		longitude: -70,
		width: null,
		height: null,
		durationMs: null,
		previewUrl: "",
		isInCurrentTrip: false,
	};
	expect(resolveMediaMapPosition({ media, workouts: [workout] })).toMatchObject(
		{
			source: "workout",
			latitude: 5,
			longitude: 15,
		},
	);
	expect(
		resolveMediaMapPosition({
			media: {
				...media,
				effectiveCapturedAt: "2025-01-02T00:05:00Z",
			},
			workouts: [workout],
		}),
	).toMatchObject({ source: "gps", latitude: 40, longitude: -70 });
});
