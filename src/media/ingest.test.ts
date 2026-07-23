import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db";
import { LibraryRepository } from "../db/library";
import { ingestMediaFromPath } from "./ingest";

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("path media ingestion storage modes", () => {
	for (const mode of ["copy", "move", "hardlink"] as const) {
		it(`${mode} stores a permanent original when processing fails`, async () => {
			const root = await mkdtemp(join(tmpdir(), "travel-map-ingest-"));
			directories.push(root);
			const source = join(root, "source.jpg");
			await writeFile(source, "not a valid image");
			const sourceBefore = await stat(source);
			const database = openDatabase(":memory:");
			const repository = new LibraryRepository(database);
			const importRecord = repository.createImport({
				kind: "media",
				sourceType: "local-backfill",
				sourceName: root,
			});
			const item = repository.createImportItem({
				importId: importRecord.id,
				sourceKey: "source.jpg",
				entityType: "media",
				originalFilename: "source.jpg",
			});
			const media = await ingestMediaFromPath({
				sourcePath: source,
				importId: importRecord.id,
				importItemId: item.id,
				storageMode: mode,
				context: {
					repository,
					assetRoot: join(root, "assets"),
					tempRoot: join(root, "assets", ".tmp"),
				},
			});
			expect(media.status).toBe("failed");
			const managed = join(root, "assets", media.originalRelativePath);
			expect((await stat(managed)).size).toBeGreaterThan(0);
			if (mode === "move") await expect(stat(source)).rejects.toThrow();
			else expect((await stat(source)).size).toBe(sourceBefore.size);
			if (mode === "hardlink")
				expect((await stat(managed)).ino).toBe((await stat(source)).ino);
			database.close();
		});
	}
});
