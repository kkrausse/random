import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

describe("loadConfig", () => {
	it("resolves configured paths from the working directory", () => {
		expect(
			loadConfig(
				{
					DATABASE_PATH: "data/app.sqlite",
					ASSET_ROOT: "assets",
					ASSET_TEMP_ROOT: "tmp",
				},
				"/app",
			),
		).toEqual({
			DATABASE_PATH: "/app/data/app.sqlite",
			ASSET_ROOT: "/app/assets",
			ASSET_TEMP_ROOT: "/app/tmp",
		});
	});

	it("requires the database path and asset root", () => {
		expect(() => loadConfig({}, "/app")).toThrow("DATABASE_PATH");
		expect(() => loadConfig({ DATABASE_PATH: "app.sqlite" }, "/app")).toThrow(
			"ASSET_ROOT",
		);
	});
});
