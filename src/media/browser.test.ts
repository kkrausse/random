import { describe, expect, it } from "vitest";
import { groupMediaIntoSessions, toggleMediaSelection } from "./browser";
import type { MediaBrowserItem } from "./types";

const item = (
	id: string,
	effectiveCapturedAt: string | null,
): MediaBrowserItem => ({
	id,
	kind: "photo",
	status: "ready",
	effectiveCapturedAt,
	latitude: null,
	longitude: null,
	width: 10,
	height: 10,
	durationMs: null,
	previewUrl: `/media/${id}/thumbnail`,
	isInCurrentTrip: false,
});

describe("groupMediaIntoSessions", () => {
	it("uses a strict seven hour gap and groups unknown timestamps", () => {
		const groups = groupMediaIntoSessions([
			item("unknown", null),
			item("c", "2025-01-01T14:00:00.001Z"),
			item("a", "2025-01-01T00:00:00.000Z"),
			item("b", "2025-01-01T07:00:00.000Z"),
		]);
		expect(groups.map((group) => group.items.map(({ id }) => id))).toEqual([
			["a", "b"],
			["c"],
			["unknown"],
		]);
	});
});

it("toggles individual and group selections", () => {
	expect([...toggleMediaSelection(new Set(["a"]), ["a", "b"])]).toEqual([
		"a",
		"b",
	]);
	expect([...toggleMediaSelection(new Set(["a", "b"]), ["a", "b"])]).toEqual(
		[],
	);
});
