import { Temporal } from "@js-temporal/polyfill";

export type CaptureTimeZoneSource =
	| "metadata-offset"
	| "sony-time-zone"
	| "gps"
	| "metadata-utc"
	| "user";

export type CaptureTime = {
	capturedAt: string | null;
	capturedAtLocal: string | null;
	capturedTimeZone: string | null;
	capturedTimeZoneSource: CaptureTimeZoneSource | null;
};

export function captureTimeFromPhotoMetadata(
	metadata: Record<string, unknown>,
): CaptureTime {
	const original = stringValue(
		metadata.SubSecDateTimeOriginal ??
			metadata.DateTimeOriginal ??
			metadata.SubSecCreateDate ??
			metadata.CreateDate,
	);
	const capturedAtLocal = normalizeExifLocalDate(original);
	const embeddedOffset =
		extractOffset(original) ??
		normalizeOffset(
			metadata.OffsetTimeOriginal ?? metadata.OffsetTimeDigitized,
		);
	if (capturedAtLocal && embeddedOffset) {
		return resolvedCaptureTime(
			capturedAtLocal,
			embeddedOffset,
			"metadata-offset",
		);
	}

	const sonyOffset = sonyTimeZoneOffset(metadata);
	if (capturedAtLocal && sonyOffset) {
		return resolvedCaptureTime(capturedAtLocal, sonyOffset, "sony-time-zone");
	}

	const gpsInstant = parseInstant(metadata.GPSDateTime);
	if (gpsInstant) {
		return {
			capturedAt: gpsInstant,
			capturedAtLocal,
			capturedTimeZone: capturedAtLocal
				? inferOffset(capturedAtLocal, gpsInstant)
				: "+00:00",
			capturedTimeZoneSource: "gps",
		};
	}

	return {
		capturedAt: null,
		capturedAtLocal,
		capturedTimeZone: null,
		capturedTimeZoneSource: null,
	};
}

export function captureTimeFromVideoMetadata(
	tags: Record<string, unknown>,
): CaptureTime {
	const localValue = stringValue(
		tags["com.apple.quicktime.creationdate"] ?? tags.creationdate,
	);
	const capturedAtLocal = normalizeExifLocalDate(localValue);
	const offset = extractOffset(localValue);
	if (capturedAtLocal && offset) {
		return resolvedCaptureTime(capturedAtLocal, offset, "metadata-offset");
	}

	const capturedAt = parseInstant(tags.creation_time);
	return {
		capturedAt,
		capturedAtLocal:
			capturedAtLocal ?? (capturedAt ? capturedAt.slice(0, 19) : null),
		capturedTimeZone: capturedAt ? "+00:00" : null,
		capturedTimeZoneSource: capturedAt ? "metadata-utc" : null,
	};
}

export function extractExifLocalDateTime(metadataJson: string): string | null {
	try {
		const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
		return normalizeExifLocalDate(
			stringValue(
				metadata.SubSecDateTimeOriginal ??
					metadata.DateTimeOriginal ??
					metadata.SubSecCreateDate ??
					metadata.CreateDate,
			),
		);
	} catch {
		return null;
	}
}

export function resolveLocalDateTime(local: string, timeZone: string): string {
	const normalized = normalizeExifLocalDate(local);
	if (!normalized) throw new Error("Invalid local capture time.");
	const offset = normalizeOffset(timeZone);
	if (offset) return Temporal.Instant.from(`${normalized}${offset}`).toString();
	return Temporal.PlainDateTime.from(normalized)
		.toZonedDateTime(timeZone, { disambiguation: "compatible" })
		.toInstant()
		.toString();
}

export function isValidTimeZone(timeZone: string): boolean {
	try {
		if (normalizeOffset(timeZone)) return true;
		Temporal.Now.instant().toZonedDateTimeISO(timeZone);
		return true;
	} catch {
		return false;
	}
}

function resolvedCaptureTime(
	capturedAtLocal: string,
	timeZone: string,
	source: CaptureTimeZoneSource,
): CaptureTime {
	return {
		capturedAt: resolveLocalDateTime(capturedAtLocal, timeZone),
		capturedAtLocal,
		capturedTimeZone: timeZone,
		capturedTimeZoneSource: source,
	};
}

function normalizeExifLocalDate(value: string | null): string | null {
	if (!value) return null;
	const match = value.match(
		/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?/,
	);
	return match
		? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${match[7] ?? ""}`
		: null;
}

function extractOffset(value: string | null): string | null {
	return normalizeOffset(value?.match(/(?:Z|[+-]\d{2}:?\d{2})$/)?.[0]);
}

function normalizeOffset(value: unknown): string | null {
	if (typeof value === "number" && Number.isFinite(value))
		return formatOffset(Math.round(value * 60));
	if (typeof value !== "string") return null;
	if (value === "Z") return "+00:00";
	const hoursOnly = value.trim().match(/^([+-]?)(\d{1,2})$/);
	if (hoursOnly && Number(hoursOnly[2]) <= 23)
		return formatOffset(
			(hoursOnly[1] === "-" ? -1 : 1) * Number(hoursOnly[2]) * 60,
		);
	const match = value.trim().match(/^([+-])(\d{2}):?(\d{2})$/);
	if (!match || Number(match[2]) > 23 || Number(match[3]) > 59) return null;
	return `${match[1]}${match[2]}:${match[3]}`;
}

function sonyTimeZoneOffset(metadata: Record<string, unknown>): string | null {
	const base = normalizeOffset(metadata.TimeZone);
	if (!base) return null;
	const daylight = metadata.DaylightSavings;
	if (daylight !== 1 && daylight !== "1" && daylight !== "On") return base;
	const sign = base.startsWith("-") ? -1 : 1;
	const minutes =
		sign * (Number(base.slice(1, 3)) * 60 + Number(base.slice(4, 6))) + 60;
	return formatOffset(minutes);
}

function inferOffset(local: string, instant: string): string | null {
	try {
		const plain = Temporal.PlainDateTime.from(local);
		const localAsUtc = plain
			.toZonedDateTime("UTC")
			.toInstant().epochMilliseconds;
		const actual = Temporal.Instant.from(instant).epochMilliseconds;
		const minutes = Math.round((localAsUtc - actual) / 60_000);
		return Math.abs(minutes) <= 24 * 60 ? formatOffset(minutes) : null;
	} catch {
		return null;
	}
}

function formatOffset(minutes: number) {
	const sign = minutes < 0 ? "-" : "+";
	const absolute = Math.abs(minutes);
	return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

function parseInstant(value: unknown): string | null {
	if (typeof value !== "string") return null;
	try {
		const normalized = value
			.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3")
			.replace(" ", "T");
		return Temporal.Instant.from(normalized).toString();
	} catch {
		return null;
	}
}

function stringValue(value: unknown) {
	return typeof value === "string" ? value : null;
}
