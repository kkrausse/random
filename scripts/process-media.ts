import { loadConfig } from "../src/config";
import { openDatabase } from "../src/db";
import { LibraryRepository } from "../src/db/library";
import { processStoredMediaOriginal } from "../src/media/ingest";
import { resolveRelativePath } from "../src/storage/paths";

type Arguments = {
	importId?: string;
	limit?: number;
};

async function main() {
	const args = parseArguments(Bun.argv.slice(2));
	const config = loadConfig();
	const database = openDatabase(config.DATABASE_PATH);
	const repository = new LibraryRepository(database);
	const media = repository.listProcessingMedia(args);
	let ready = 0;
	let failed = 0;
	for (const [index, item] of media.entries()) {
		console.log(`[${index + 1}/${media.length}] ${item.media.originalFilename} (ready ${ready}, failed ${failed})`);
		const processed = await processStoredMediaOriginal({
			mediaId: item.media.id,
			originalPath: resolveRelativePath(config.ASSET_ROOT, item.media.originalRelativePath),
			importItemId: item.importItemId,
			context: { repository, assetRoot: config.ASSET_ROOT, tempRoot: config.ASSET_TEMP_ROOT ?? `${config.ASSET_ROOT}/.tmp` },
		});
		if (processed.status === "ready") ready += 1;
		else failed += 1;
	}
	database.close();
	console.log(`Media processing complete: ${ready} ready, ${failed} failed`);
}

function parseArguments(values: string[]): Arguments {
	const result: Arguments = {};
	for (let index = 0; index < values.length; index += 1) {
		const value = values[index];
		if (value === "--import") result.importId = requiredValue(values, ++index, value);
		else if (value === "--limit") result.limit = Number(requiredValue(values, ++index, value));
		else throw new Error(`Unknown argument: ${value}`);
	}
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
