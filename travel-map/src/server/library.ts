import "@tanstack/react-start/server-only";
import { mkdirSync } from "node:fs";
import { loadConfig } from "../config";
import { openDatabase } from "../db";
import { LibraryRepository } from "../db/library";
import { createAssetPaths } from "../storage/paths";

let singleton: ReturnType<typeof createLibrary> | undefined;

export function getLibrary() {
	if (!singleton) singleton = createLibrary();
	return singleton;
}

function createLibrary() {
	const config = loadConfig();
	mkdirSync(config.ASSET_ROOT, { recursive: true });
	mkdirSync(config.ASSET_TEMP_ROOT ?? `${config.ASSET_ROOT}/.tmp`, {
		recursive: true,
	});
	const db = openDatabase(config.DATABASE_PATH);
	return {
		config,
		paths: createAssetPaths(config),
		repository: new LibraryRepository(db),
	};
}
