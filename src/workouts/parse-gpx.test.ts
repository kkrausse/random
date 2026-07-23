import { expect, it } from "vitest";
import { parseGpxWorkout } from "./parse-gpx";

it("normalizes GPX route points without a DOM", () => {
	const workout =
		parseGpxWorkout(`<?xml version="1.0"?><gpx><trk><name>Walk</name><trkseg>
		<trkpt lat="40" lon="-70"><ele>12.5</ele><time>2025-01-01T00:00:00Z</time></trkpt>
		<trkpt lat="40.001" lon="-70.001"><time>2025-01-01T00:01:00Z</time></trkpt>
	</trkseg></trk></gpx>`);
	expect(workout.title).toBe("Walk");
	expect(workout.points).toHaveLength(2);
	expect(workout.points[0].elevationMeters).toBe(12.5);
	expect(workout.distanceMeters).toBeGreaterThan(100);
});

it("rejects routes without timed points", () => {
	expect(() => parseGpxWorkout("<gpx />")).toThrow("no timed route points");
});
