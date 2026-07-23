import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
			const originalBytes = "not a valid image";
			await writeFile(source, originalBytes);
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
			const managedInfo = await stat(managed);
			expect(managedInfo.size).toBeGreaterThan(0);
			expect(managedInfo.mode & 0o222).toBe(0);
			await expect(writeFile(managed, "changed")).rejects.toMatchObject({
				code: "EACCES",
			});
			expect(await readFile(managed, "utf8")).toBe(originalBytes);
			if (mode === "move") await expect(stat(source)).rejects.toThrow();
			else expect((await stat(source)).size).toBe(sourceBefore.size);
			if (mode === "hardlink") {
				expect((await stat(managed)).ino).toBe((await stat(source)).ino);
				expect((await stat(source)).mode & 0o222).toBe(0);
				await expect(writeFile(source, "changed")).rejects.toMatchObject({
					code: "EACCES",
				});
				expect(await readFile(source, "utf8")).toBe(originalBytes);
			}
			database.close();
		});
	}
});
