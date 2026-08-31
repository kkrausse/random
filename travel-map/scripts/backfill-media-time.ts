import { loadConfig } from "../src/config";
import { openDatabase } from "../src/db";
import { LibraryRepository } from "../src/db/library";
import { mapWithConcurrency } from "../src/lib/map-with-concurrency";
import { readCaptureMetadata } from "../src/media/read-capture-metadata";
import { resolveRelativePath } from "../src/storage/paths";

type Arguments = {
	kind?: "photo" | "video";
	limit?: number;
	concurrency: number;
	dryRun: boolean;
	replaceUserTimeZones: boolean;
};

async function main() {
	const args = parseArguments(Bun.argv.slice(2));
	const config = loadConfig();
	const database = openDatabase(config.DATABASE_PATH);
	const repository = new LibraryRepository(database);
	const media = repository.listReadyMediaForTimeBackfill(args);
	let updated = 0;
	let unresolved = 0;
	let failed = 0;

	try {
		await mapWithConcurrency(media, args.concurrency, async (item, index) => {
			if (!item.kind) return;
			try {
				const capture = await readCaptureMetadata(
					resolveRelativePath(config.ASSET_ROOT, item.originalRelativePath),
					item.kind,
				);
				if (!capture.capturedAtLocal && !capture.capturedAt) unresolved += 1;
				if (!args.dryRun) {
					repository.updateMediaCaptureMetadata(item.id, capture, {
						replaceUserTimeZone: args.replaceUserTimeZones,
					});
				}
				updated += 1;
				console.log(
					`[${index + 1}/${media.length}] ${item.originalFilename}: ${capture.capturedAtLocal ?? "no local time"} ${capture.capturedTimeZone ?? "timezone unknown"}`,
				);
			} catch (error) {
				failed += 1;
				console.error(
					`[${index + 1}/${media.length}] ${item.originalFilename}: ${error instanceof Error ? error.message : "metadata read failed"}`,
				);
			}
		});
	} finally {
		database.close();
	}

	console.log(
		`Media time ${args.dryRun ? "scan" : "backfill"} complete: ${updated} read, ${unresolved} unresolved, ${failed} failed`,
	);
	if (failed > 0) process.exitCode = 1;
}

function parseArguments(values: string[]): Arguments {
	const result: Arguments = {
		concurrency: 4,
		dryRun: false,
		replaceUserTimeZones: false,
	};
	for (let index = 0; index < values.length; index += 1) {
		const value = values[index];
		if (value === "--dry-run") result.dryRun = true;
		else if (value === "--replace-user-timezones")
			result.replaceUserTimeZones = true;
		else if (value === "--kind") {
			const kind = requiredValue(values, ++index, value);
			if (kind !== "photo" && kind !== "video")
				throw new Error("--kind must be photo or video");
			result.kind = kind;
		} else if (value === "--limit")
			result.limit = Number(requiredValue(values, ++index, value));
		else if (value === "--concurrency")
			result.concurrency = Number(requiredValue(values, ++index, value));
		else throw new Error(`Unknown argument: ${value}`);
	}
	if (result.limit !== undefined && (!Number.isInteger(result.limit) || result.limit < 1))
		throw new Error("--limit must be a positive integer");
	if (!Number.isInteger(result.concurrency) || result.concurrency < 1)
		throw new Error("--concurrency must be a positive integer");
	return result;
}

function requiredValue(values: string[], index: number, option: string) {
	const value = values[index];
	if (!value || value.startsWith("--"))
		throw new Error(`${option} requires a value`);
	return value;
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
