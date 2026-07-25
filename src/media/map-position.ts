import type {
	MediaBrowserItem,
	ResolvedMediaPosition,
	WorkoutPoint,
	WorkoutWithPoints,
} from "./types";

export const MAX_INTERPOLATION_POINT_GAP_MS = 10 * 60 * 1000;

export function interpolateWorkoutPosition(
	points: WorkoutPoint[],
	timestamp: Date,
): { latitude: number; longitude: number } | null {
	const target = timestamp.getTime();
	if (!Number.isFinite(target) || points.length === 0) return null;

	for (let index = 0; index < points.length; index += 1) {
		const point = points[index];
		const pointTime = Date.parse(point.recordedAt);
		if (!Number.isFinite(pointTime)) continue;
		if (pointTime === target) {
			return { latitude: point.latitude, longitude: point.longitude };
		}
		if (pointTime > target && index > 0) {
			const previous = points[index - 1];
			const previousTime = Date.parse(previous.recordedAt);
			const gap = pointTime - previousTime;
			if (
				!Number.isFinite(previousTime) ||
				previousTime > target ||
				gap <= 0 ||
				gap > MAX_INTERPOLATION_POINT_GAP_MS
			) {
				return null;
			}
			const ratio = (target - previousTime) / gap;
			return {
				latitude:
					previous.latitude + (point.latitude - previous.latitude) * ratio,
				longitude:
					previous.longitude + (point.longitude - previous.longitude) * ratio,
			};
		}
	}
	return null;
}

export function resolveMediaMapPosition(input: {
	media: MediaBrowserItem;
	workouts: WorkoutWithPoints[];
}): ResolvedMediaPosition | null {
	if (input.media.effectiveCapturedAt) {
		const timestamp = new Date(input.media.effectiveCapturedAt);
		const time = timestamp.getTime();
		if (Number.isFinite(time)) {
			for (const workout of input.workouts) {
				if (
					time < Date.parse(workout.startedAt) ||
					time > Date.parse(workout.endedAt)
				) {
					continue;
				}
				const position = interpolateWorkoutPosition(workout.points, timestamp);
				if (position)
					return { ...position, source: "workout", workoutId: workout.id };
			}
		}
	}
	if (input.media.latitude !== null && input.media.longitude !== null) {
		return {
			latitude: input.media.latitude,
			longitude: input.media.longitude,
			source: "gps",
		};
	}
	return null;
}

export function mediaInterpolatesOntoWorkout(
	media: MediaBrowserItem,
	workout: WorkoutWithPoints,
) {
	const position = resolveMediaMapPosition({ media, workouts: [workout] });
	return position?.source === "workout" && position.workoutId === workout.id;
}
