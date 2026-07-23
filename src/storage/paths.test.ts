import { describe, expect, it } from "vitest";
import {
	derivedMediaKey,
	originalMediaKey,
	resolveRelativePath,
} from "./paths";

describe("asset paths", () => {
	it("builds portable media keys", () => {
		expect(originalMediaKey("media-1", "Camera.ARW")).toBe(
			"media/originals/media-1/original.arw",
		);
		expect(derivedMediaKey("media-1", "viewer.webp")).toBe(
			"media/derived/media-1/viewer.webp",
		);
	});

	it("resolves safe keys below the root", () => {
		expect(resolveRelativePath("/assets", "media/derived/a/viewer.webp")).toBe(
			"/assets/media/derived/a/viewer.webp",
		);
	});

	it.each([
		"../secret",
		"media/../../secret",
		"/etc/passwd",
		"a\\..\\secret",
		"a//b",
	])("rejects unsafe key %s", (key) => {
		expect(() => resolveRelativePath("/assets", key)).toThrow();
	});
});
