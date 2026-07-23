import { describe, expect, it } from "vitest";
import { openDatabase, runMigrations } from "./database";
import { LibraryRepository } from "./library";

describe("database migrations", () => {
	it("apply once and enforce foreign keys and relationship uniqueness", () => {
		const db = openDatabase(":memory:");
		runMigrations(db);
		expect(
			db
				.query<{ count: number }, []>(
					"SELECT count(*) AS count FROM schema_migrations",
				)
				.get()?.count,
		).toBe(2);
		const repository = new LibraryRepository(db);
		const trip = repository.createTrip("Test trip");
		const importRecord = repository.createImport({
			kind: "media",
			sourceType: "browser",
			sourceName: "test",
		});
		const now = new Date().toISOString();
		db.query(
			"INSERT INTO media (id, import_id, status, kind, original_filename, original_relative_path, original_byte_size, storage_mode, metadata_json, processing_version, created_at, updated_at) VALUES ('media', ?, 'ready', 'photo', 'x.jpg', 'media/originals/media/original.jpg', 1, 'upload', '{}', 'media-v1', ?, ?)",
		).run(importRecord.id, now, now);
		db.query(
			"INSERT INTO trip_media (trip_id, media_id, added_at) VALUES (?, 'media', ?)",
		).run(trip.id, now);
		expect(() =>
			db
				.query(
					"INSERT INTO trip_media (trip_id, media_id, added_at) VALUES (?, 'media', ?)",
				)
				.run(trip.id, now),
		).toThrow();
		expect(() =>
			db
				.query(
					"INSERT INTO trip_media (trip_id, media_id, added_at) VALUES ('missing', 'media', ?)",
				)
				.run(now),
		).toThrow();
		db.close();
	});

	it("keeps import source keys unique within an import", () => {
		const db = openDatabase(":memory:");
		const repository = new LibraryRepository(db);
		const record = repository.createImport({
			kind: "media",
			sourceType: "browser",
			sourceName: "test",
		});
		repository.createImportItem({
			importId: record.id,
			sourceKey: "one",
			entityType: "media",
			originalFilename: "one.jpg",
		});
		expect(() =>
			repository.createImportItem({
				importId: record.id,
				sourceKey: "one",
				entityType: "media",
				originalFilename: "two.jpg",
			}),
		).toThrow();
		db.close();
	});

	it("keeps non-null media content hashes unique", () => {
		const db = openDatabase(":memory:");
		const repository = new LibraryRepository(db);
		const record = repository.createImport({
			kind: "media",
			sourceType: "local-backfill",
			sourceName: "test",
		});
		const create = (id: string) =>
			repository.createProcessingMedia({
				id,
				importId: record.id,
				originalFilename: `${id}.jpg`,
				originalRelativePath: `media/originals/${id}/original.jpg`,
				originalByteSize: 1,
				contentHash: "same-sha256",
				storageMode: "copy",
				processingVersion: "media-v1",
			});
		create("one");
		expect(() => create("two")).toThrow();
		db.close();
	});
});
