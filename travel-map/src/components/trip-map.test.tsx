// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { type ReactNode, type Ref, useImperativeHandle } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaBrowserItem, WorkoutWithPoints } from "../media/types";
import { TripMap } from "./trip-map";

const mapApi = vi.hoisted(() => ({
	resize: vi.fn(),
	easeTo: vi.fn(),
	fitBounds: vi.fn(),
	getZoom: vi.fn(() => 14),
}));

vi.mock("react-map-gl/maplibre", () => ({
	default: function MockMap({
		children,
		ref,
	}: {
		children: ReactNode;
		ref?: Ref<typeof mapApi>;
	}) {
		useImperativeHandle(ref, () => mapApi);
		return <div>{children}</div>;
	},
	Layer: () => null,
	Marker: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	NavigationControl: () => null,
	Source: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

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
	it("moves between mapped photos and restores their map focus", async () => {
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
		expect(
			screen
				.getByAltText("Selected")
				.closest(".trip-map")
				?.classList.contains("has-photo"),
		).toBe(true);
		expect(
			screen
				.getByRole("button", { name: "Previous photo" })
				.hasAttribute("disabled"),
		).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
		expect(screen.getByAltText("Selected").getAttribute("src")).toBe(
			"/media/last/viewer",
		);
		expect(
			screen
				.getByRole("button", { name: "Next photo" })
				.hasAttribute("disabled"),
		).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "Previous photo" }));
		const wheel = new WheelEvent("wheel", {
			bubbles: true,
			cancelable: true,
			clientX: 10,
			clientY: 10,
			deltaY: -100,
		});
		const stage = screen.getByAltText("Selected").parentElement;
		if (!stage) throw new Error("Photo stage was not rendered");
		vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({
			bottom: 200,
			height: 200,
			left: 0,
			right: 200,
			top: 0,
			width: 200,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		});
		expect(fireEvent(stage, wheel)).toBe(false);
		expect(screen.getByAltText("Selected").style.transform).not.toBe(
			"scale(1)",
		);
		expect(stage.classList.contains("can-pan")).toBe(true);
		expect(screen.getByAltText("Selected").getAttribute("src")).toBe(
			"/media/first/max",
		);
		await waitFor(() => expect(mapApi.easeTo).toHaveBeenCalled());
		const focusCount = mapApi.easeTo.mock.calls.length;
		fireEvent.keyDown(window, { key: "Escape" });
		expect(screen.queryByAltText("Selected")).toBeNull();
		await waitFor(() =>
			expect(mapApi.easeTo.mock.calls.length).toBeGreaterThan(focusCount),
		);
		expect(mapApi.easeTo).toHaveBeenLastCalledWith({
			center: [2.2, 1.2],
			zoom: 14,
			duration: 500,
		});

		fireEvent.click(screen.getAllByRole("button", { name: "Open photo" })[1]);
		fireEvent.keyDown(window, { key: "ArrowRight" });
		expect(screen.getByAltText("Selected").getAttribute("src")).toBe(
			"/media/last/viewer",
		);

		fireEvent.keyDown(window, { key: "ArrowLeft" });
		expect(screen.getByAltText("Selected").getAttribute("src")).toBe(
			"/media/first/viewer",
		);
	});

	it("opens a photo selected by an external browser", () => {
		render(
			<TripMap
				workouts={[workout]}
				media={[photo("selected", "2025-01-01T00:02:00Z")]}
				selectedPhotoId="selected"
			/>,
		);

		expect(screen.getByAltText("Selected").getAttribute("src")).toBe(
			"/media/selected/viewer",
		);
	});

	it("allows touch pinch zoom beyond the desktop wheel limit", () => {
		render(
			<TripMap
				workouts={[workout]}
				media={[photo("selected", "2025-01-01T00:02:00Z")]}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Open photo" }));
		const image = screen.getByAltText("Selected");
		const stage = image.parentElement;
		if (!stage) throw new Error("Photo stage was not rendered");
		stage.setPointerCapture = vi.fn();
		vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({
			bottom: 400,
			height: 400,
			left: 0,
			right: 400,
			top: 0,
			width: 400,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		});

		fireEvent.pointerDown(stage, { pointerId: 1, clientX: 0, clientY: 0 });
		fireEvent.pointerDown(stage, { pointerId: 2, clientX: 100, clientY: 0 });
		fireEvent.pointerMove(stage, { pointerId: 2, clientX: 900, clientY: 0 });

		expect(image.style.transform).toContain("scale(9)");
		expect(image.getAttribute("src")).toBe("/media/selected/max");
	});
});
