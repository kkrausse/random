import { describe, expect, it } from "vitest";
import {
	captureTimeFromPhotoMetadata,
	captureTimeFromVideoMetadata,
	resolveLocalDateTime,
} from "./capture-time";

describe("photo capture time metadata", () => {
	it("reads the combined timestamp emitted by a Sony a6700", () => {
		expect(
			captureTimeFromPhotoMetadata({
				SubSecDateTimeOriginal: "2026:06:19 13:48:29.614-08:00",
				DateTimeOriginal: "2026:06:19 13:48:29",
				OffsetTimeOriginal: "-08:00",
				Make: "SONY",
				Model: "ILCE-6700",
			}),
		).toMatchObject({
			capturedAt: "2026-06-19T21:48:29.614Z",
			capturedAtLocal: "2026-06-19T13:48:29.614",
			capturedTimeZone: "-08:00",
			capturedTimeZoneSource: "metadata-offset",
		});
	});

	it("uses standard EXIF offsets from iPhone-style metadata", () => {
		expect(
			captureTimeFromPhotoMetadata({
				DateTimeOriginal: "2025:07:20 15:30:00",
				OffsetTimeOriginal: "-07:00",
			}),
		).toMatchObject({
			capturedAt: "2025-07-20T22:30:00Z",
			capturedAtLocal: "2025-07-20T15:30:00",
			capturedTimeZone: "-07:00",
			capturedTimeZoneSource: "metadata-offset",
		});
	});

	it("applies Sony timezone and daylight-saving metadata", () => {
		expect(
			captureTimeFromPhotoMetadata({
				DateTimeOriginal: "2025:07:20 15:30:00",
				TimeZone: -8,
				DaylightSavings: 1,
			}),
		).toMatchObject({
			capturedAt: "2025-07-20T22:30:00Z",
			capturedTimeZone: "-07:00",
			capturedTimeZoneSource: "sony-time-zone",
		});
	});

	it("uses GPS UTC and infers its offset from camera wall time", () => {
		expect(
			captureTimeFromPhotoMetadata({
				DateTimeOriginal: "2025:07:20 15:30:00",
				GPSDateTime: "2025:07:20 22:30:00Z",
			}),
		).toMatchObject({
			capturedAt: "2025-07-20T22:30:00Z",
			capturedTimeZone: "-07:00",
			capturedTimeZoneSource: "gps",
		});
	});
});

it("uses an iPhone QuickTime creation date before generic UTC metadata", () => {
	expect(
		captureTimeFromVideoMetadata({
			"com.apple.quicktime.creationdate": "2025-07-20T15:30:00-07:00",
			creation_time: "2025-07-20T22:30:00Z",
		}),
	).toMatchObject({
		capturedAt: "2025-07-20T22:30:00Z",
		capturedAtLocal: "2025-07-20T15:30:00",
		capturedTimeZone: "-07:00",
	});
});

it("resolves IANA zones with daylight-saving rules", () => {
	expect(
		resolveLocalDateTime("2025-07-20T15:30:00", "America/Los_Angeles"),
	).toBe("2025-07-20T22:30:00Z");
	expect(
		resolveLocalDateTime("2025-01-20T15:30:00", "America/Los_Angeles"),
	).toBe("2025-01-20T23:30:00Z");
});
