import type {
	MediaBrowserItem,
	ResolvedMediaPosition,
	WorkoutPoint,
	WorkoutWithPoints,
} from "./types";

export const MAX_INTERPOLATION_POINT_GAP_MS = 10 * 60 * 1000;

const pointTimesCache = new WeakMap<
	WorkoutPoint[],
	{ times: number[]; canBinarySearch: boolean }
>();

export function interpolateWorkoutPosition(
	points: WorkoutPoint[],
	timestamp: Date,
): { latitude: number; longitude: number } | null {
	const target = timestamp.getTime();
	if (!Number.isFinite(target) || points.length === 0) return null;

	let cachedPointTimes = pointTimesCache.get(points);
	if (!cachedPointTimes) {
		const times = points.map((point) => Date.parse(point.recordedAt));
		cachedPointTimes = {
			times,
			canBinarySearch: times.every(Number.isFinite),
		};
		pointTimesCache.set(points, cachedPointTimes);
	}
	const pointTimes = cachedPointTimes.times;
	if (!cachedPointTimes.canBinarySearch) {
		return interpolateWorkoutPositionLinearly(points, pointTimes, target);
	}

	let low = 0;
	let high = pointTimes.length;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if (pointTimes[middle] < target) low = middle + 1;
		else high = middle;
	}
	if (low < points.length && pointTimes[low] === target) {
		return { latitude: points[low].latitude, longitude: points[low].longitude };
	}
	if (low === 0 || low === points.length) return null;
	return interpolateBetween(points, pointTimes, low, target);
}

function interpolateWorkoutPositionLinearly(
	points: WorkoutPoint[],
	pointTimes: number[],
	target: number,
) {
	for (let index = 0; index < points.length; index += 1) {
		const pointTime = pointTimes[index];
		if (!Number.isFinite(pointTime)) continue;
		if (pointTime === target) {
			return {
				latitude: points[index].latitude,
				longitude: points[index].longitude,
			};
		}
		if (pointTime > target && index > 0) {
			return interpolateBetween(points, pointTimes, index, target);
		}
	}
	return null;
}

function interpolateBetween(
	points: WorkoutPoint[],
	pointTimes: number[],
	index: number,
	target: number,
) {
	const point = points[index];
	const previous = points[index - 1];
	const pointTime = pointTimes[index];
	const previousTime = pointTimes[index - 1];
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
		latitude: previous.latitude + (point.latitude - previous.latitude) * ratio,
		longitude:
			previous.longitude + (point.longitude - previous.longitude) * ratio,
	};
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
