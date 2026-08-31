export type ParsedWorkoutPoint = {
	recordedAt: string;
	latitude: number;
	longitude: number;
	elevationMeters: number | null;
};

export type ParsedWorkout = {
	title: string | null;
	startedAt: string;
	endedAt: string;
	distanceMeters: number;
	points: ParsedWorkoutPoint[];
};

export function parseGpxWorkout(xml: string): ParsedWorkout {
	const points: ParsedWorkoutPoint[] = [];
	const pointPattern = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/gi;
	for (const match of xml.matchAll(pointPattern)) {
		const latitude = Number(attribute(match[1], "lat"));
		const longitude = Number(attribute(match[1], "lon"));
		const timeText = elementText(match[2], "time");
		const recordedAt = timeText ? new Date(timeText) : null;
		if (
			!Number.isFinite(latitude) ||
			!Number.isFinite(longitude) ||
			!recordedAt ||
			Number.isNaN(recordedAt.getTime())
		) {
			continue;
		}
		const elevationText = elementText(match[2], "ele");
		const elevation = elevationText === null ? null : Number(elevationText);
		points.push({
			recordedAt: recordedAt.toISOString(),
			latitude,
			longitude,
			elevationMeters:
				elevation !== null && Number.isFinite(elevation) ? elevation : null,
		});
	}
	if (points.length === 0)
		throw new Error("The GPX file has no timed route points.");
	points.sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
	return {
		title: elementText(xml, "name"),
		startedAt: points[0].recordedAt,
		endedAt: points.at(-1)?.recordedAt ?? points[0].recordedAt,
		distanceMeters: calculateDistance(points),
		points,
	};
}

function attribute(attributes: string, name: string) {
	return attributes.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"))?.[1];
}

function elementText(xml: string, name: string) {
	const value = xml.match(
		new RegExp(`<${name}\\b[^>]*>([^<]+)</${name}>`, "i"),
	)?.[1];
	return value?.trim() || null;
}

function calculateDistance(points: ParsedWorkoutPoint[]) {
	let distance = 0;
	for (let index = 1; index < points.length; index += 1) {
		const from = points[index - 1];
		const to = points[index];
		const latitudeDelta = radians(to.latitude - from.latitude);
		const longitudeDelta = radians(to.longitude - from.longitude);
		const value =
			Math.sin(latitudeDelta / 2) ** 2 +
			Math.cos(radians(from.latitude)) *
				Math.cos(radians(to.latitude)) *
				Math.sin(longitudeDelta / 2) ** 2;
		distance +=
			6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
	}
	return distance;
}

function radians(value: number) {
	return (value * Math.PI) / 180;
}
