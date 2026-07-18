import JSZip from "jszip";

export type RouteSummary = {
	id: string;
	date: Date;
	label: string;
	path: string;
};

export type RoutePoint = {
	latitude: number;
	longitude: number;
	time?: Date;
};

export type WorkoutRoute = RouteSummary & {
	points: RoutePoint[];
	distanceMeters: number;
	durationSeconds?: number;
};

const routePath =
	/workout-routes\/route_(\d{4}-\d{2}-\d{2})_(\d{1,2})\.(\d{2})(am|pm)\.gpx$/i;

export async function openAppleHealthExport(file: Blob) {
	return JSZip.loadAsync(file);
}

export function listWorkoutRoutes(zip: JSZip): RouteSummary[] {
	return Object.values(zip.files)
		.filter((file) => !file.dir)
		.map((file) => {
			const match = file.name.match(routePath);
			if (!match) return undefined;

			const [, datePart, hourPart, minutePart, meridiem] = match;
			let hour = Number(hourPart);
			if (meridiem.toLowerCase() === "pm" && hour !== 12) hour += 12;
			if (meridiem.toLowerCase() === "am" && hour === 12) hour = 0;

			const date = new Date(
				`${datePart}T${String(hour).padStart(2, "0")}:${minutePart}:00`,
			);
			return {
				id: file.name,
				date,
				label: formatRouteDate(date),
				path: file.name,
			};
		})
		.filter((route): route is RouteSummary => Boolean(route))
		.sort((a, b) => b.date.getTime() - a.date.getTime());
}

export async function readWorkoutRoute(
	zip: JSZip,
	route: RouteSummary,
): Promise<WorkoutRoute> {
	const file = zip.file(route.path);
	if (!file)
		throw new Error(
			"That workout route is no longer available in this export.",
		);

	const xml = await file.async("text");
	const document = new DOMParser().parseFromString(xml, "application/xml");
	if (document.querySelector("parsererror"))
		throw new Error("The selected route could not be read.");

	const points = Array.from(document.getElementsByTagName("trkpt"))
		.map((element) => {
			const latitude = Number(element.getAttribute("lat"));
			const longitude = Number(element.getAttribute("lon"));
			const timeText = element.getElementsByTagName("time")[0]?.textContent;
			const time = timeText ? new Date(timeText) : undefined;
			return Number.isFinite(latitude) && Number.isFinite(longitude)
				? {
						latitude,
						longitude,
						time: time && !Number.isNaN(time.getTime()) ? time : undefined,
					}
				: undefined;
		})
		.filter((point): point is RoutePoint => Boolean(point));

	const timedPoints = points.filter(
		(point): point is RoutePoint & { time: Date } => point.time !== undefined,
	);
	const firstTimedPoint = timedPoints[0];
	const lastTimedPoint = timedPoints.at(-1);
	const durationSeconds =
		firstTimedPoint && lastTimedPoint && timedPoints.length > 1
			? (lastTimedPoint.time.getTime() - firstTimedPoint.time.getTime()) / 1000
			: undefined;

	return {
		...route,
		points,
		distanceMeters: calculateDistance(points),
		durationSeconds:
			durationSeconds && durationSeconds > 0 ? durationSeconds : undefined,
	};
}

export function formatRouteDate(date: Date) {
	return new Intl.DateTimeFormat("en", {
		weekday: "short",
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).format(date);
}

export function formatDistance(meters: number) {
	const miles = meters / 1609.344;
	return miles < 0.1
		? `${Math.round(meters)} m`
		: `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
}

export function formatDuration(seconds?: number) {
	if (!seconds) return "Time unavailable";
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.round((seconds % 3600) / 60);
	return hours ? `${hours}h ${minutes}m` : `${minutes} min`;
}

function calculateDistance(points: RoutePoint[]) {
	let distance = 0;
	for (let index = 1; index < points.length; index += 1) {
		const from = points[index - 1];
		const to = points[index];
		const latitudeDelta = degreesToRadians(to.latitude - from.latitude);
		const longitudeDelta = degreesToRadians(to.longitude - from.longitude);
		const a =
			Math.sin(latitudeDelta / 2) ** 2 +
			Math.cos(degreesToRadians(from.latitude)) *
				Math.cos(degreesToRadians(to.latitude)) *
				Math.sin(longitudeDelta / 2) ** 2;
		distance += 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	}
	return distance;
}

function degreesToRadians(value: number) {
	return (value * Math.PI) / 180;
}
