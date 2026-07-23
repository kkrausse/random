import { readdir, stat } from "node:fs/promises";
import { basename, extname, relative, resolve } from "node:path";
import { loadConfig } from "../src/config";
import { openDatabase } from "../src/db";
import { LibraryRepository } from "../src/db/library";
import { SUPPORTED_MEDIA_EXTENSIONS } from "../src/media/classify-media";
import { ingestMediaFromPath } from "../src/media/ingest";

type Arguments = {
	source: string;
	mode: "copy" | "move" | "hardlink";
	recursive: boolean;
	dryRun: boolean;
	include: Set<string>;
	limit?: number;
	continueImport?: string;
};

async function main() {
	const args = parseArguments(Bun.argv.slice(2));
	const config = loadConfig();
	const source = resolve(args.source);
	const sourceInfo = await stat(source);
	if (!sourceInfo.isDirectory()) throw new Error("--source must be a directory");
	const files = (await enumerate(source, args.recursive))
		.filter((path) => args.include.has(extname(path).toLowerCase()))
		.sort((a, b) => relative(source, a).localeCompare(relative(source, b)))
		.slice(0, args.limit);
	console.log(`Discovered ${files.length} supported media files`);
	if (args.dryRun) {
		for (const [index, path] of files.entries()) console.log(`[${index + 1}/${files.length}] ${args.mode} ${relative(source, path)}`);
		return;
	}

	const database = openDatabase(config.DATABASE_PATH);
	const repository = new LibraryRepository(database);
	const existing = args.continueImport ? repository.getImport(args.continueImport) : null;
	if (args.continueImport && (!existing || existing.sourceType !== "local-backfill")) throw new Error("--continue-import must reference a local backfill import");
	const importRecord = existing ?? repository.createImport({ kind: "media", sourceType: "local-backfill", sourceName: source });
	let ready = 0;
	let failed = 0;
	for (const [index, path] of files.entries()) {
		const sourceKey = relative(source, path).split("\\").join("/");
		let item = repository.getImportItemBySource(importRecord.id, sourceKey);
		if (item?.status === "completed") {
			ready += 1;
			continue;
		}
		if (!item) item = repository.createImportItem({ importId: importRecord.id, sourceKey, entityType: "media", originalFilename: basename(path) });
		console.log(`[${index + 1}/${files.length}] ${sourceKey} (ready ${ready}, failed ${failed})`);
		try {
			const media = await ingestMediaFromPath({ sourcePath: path, importId: importRecord.id, importItemId: item.id, storageMode: args.mode, context: { repository, assetRoot: config.ASSET_ROOT, tempRoot: config.ASSET_TEMP_ROOT ?? `${config.ASSET_ROOT}/.tmp` } });
			if (media.status === "ready") ready += 1;
			else failed += 1;
		} catch (error) {
			failed += 1;
			repository.setImportItemStatus(item.id, "failed", { errorMessage: error instanceof Error ? error.message : "Ingestion failed." });
		}
	}
	repository.updateImportStatus(importRecord.id, failed ? "completed-with-errors" : "completed");
	database.close();
	console.log(`Backfill complete: ${ready} ready, ${failed} failed (import ${importRecord.id})`);
}

async function enumerate(directory: string, recursive: boolean): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		const path = resolve(directory, entry.name);
		if (entry.isFile()) files.push(path);
		else if (recursive && entry.isDirectory()) files.push(...await enumerate(path, true));
	}
	return files;
}

function parseArguments(values: string[]): Arguments {
	const result: Arguments = { source: "", mode: "hardlink", recursive: false, dryRun: false, include: new Set(SUPPORTED_MEDIA_EXTENSIONS) };
	for (let index = 0; index < values.length; index += 1) {
		const value = values[index];
		if (value === "--recursive") result.recursive = true;
		else if (value === "--dry-run") result.dryRun = true;
		else if (value === "--source") result.source = requiredValue(values, ++index, value);
		else if (value === "--mode") {
			const mode = requiredValue(values, ++index, value);
			if (mode !== "copy" && mode !== "move" && mode !== "hardlink") throw new Error("--mode must be copy, move, or hardlink");
			result.mode = mode;
		} else if (value === "--include") result.include = new Set(requiredValue(values, ++index, value).split(",").map((extension) => extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`));
		else if (value === "--limit") result.limit = Number(requiredValue(values, ++index, value));
		else if (value === "--continue-import") result.continueImport = requiredValue(values, ++index, value);
		else throw new Error(`Unknown argument: ${value}`);
	}
	if (!result.source) throw new Error("--source is required");
	if (result.limit !== undefined && (!Number.isInteger(result.limit) || result.limit < 1)) throw new Error("--limit must be a positive integer");
	return result;
}

function requiredValue(values: string[], index: number, option: string) {
	const value = values[index];
	if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
	return value;
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
