// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { MediaBrowserItem, WorkoutWithPoints } from "../media/types";
import { TripMap } from "./trip-map";

vi.mock("react-map-gl/maplibre", () => ({
	default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	Layer: () => null,
	Marker: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	NavigationControl: () => null,
	Source: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const workout: WorkoutWithPoints = {
	id: "workout",
	startedAt: "2025-01-01T00:00:00Z",
	endedAt: "2025-01-01T00:10:00Z",
	points: [
		{ recordedAt: "2025-01-01T00:00:00Z", latitude: 1, longitude: 2 },
		{ recordedAt: "2025-01-01T00:10:00Z", latitude: 2, longitude: 3 },
	],
};

function photo(id: string, effectiveCapturedAt: string): MediaBrowserItem {
	return {
		id,
		kind: "photo",
		status: "ready",
		effectiveCapturedAt,
		capturedAtLocal: null,
		capturedTimeZone: null,
		capturedTimeZoneSource: null,
		hasCapturedAtOverride: false,
		latitude: null,
		longitude: null,
		width: null,
		height: null,
		durationMs: null,
		previewUrl: `/media/${id}/thumbnail`,
		isInCurrentTrip: true,
	};
}

describe("TripMap photo navigation", () => {
	it("moves between mapped photos in chronological order", () => {
		render(
			<TripMap
				workouts={[workout]}
				media={[
					photo("last", "2025-01-01T00:08:00Z"),
					photo("first", "2025-01-01T00:02:00Z"),
				]}
			/>,
		);

		fireEvent.click(screen.getAllByRole("button", { name: "Open photo" })[1]);
		expect(screen.getByAltText("Selected").getAttribute("src")).toBe(
			"/media/first/viewer",
		);
		const wheel = new WheelEvent("wheel", {
			bubbles: true,
			cancelable: true,
			clientX: 10,
			clientY: 10,
			deltaY: -100,
		});
		const stage = screen.getByAltText("Selected").parentElement;
		if (!stage) throw new Error("Photo stage was not rendered");
		expect(fireEvent(stage, wheel)).toBe(false);
		expect(screen.getByAltText("Selected").style.transform).not.toBe(
			"scale(1)",
		);

		fireEvent.keyDown(window, { key: "ArrowRight" });
		expect(screen.getByAltText("Selected").getAttribute("src")).toBe(
			"/media/last/viewer",
		);

		fireEvent.keyDown(window, { key: "ArrowLeft" });
		expect(screen.getByAltText("Selected").getAttribute("src")).toBe(
			"/media/first/viewer",
		);
	});
});
