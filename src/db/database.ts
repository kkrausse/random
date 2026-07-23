import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface Migration {
	version: number;
	name: string;
	sql: string;
}

interface AppliedMigration {
	version: number;
	name: string;
	checksum: string;
}

const migrations: Migration[] = [
	{
		version: 1,
		name: "initial",
		sql: readFileSync(
			join(
				dirname(fileURLToPath(import.meta.url)),
				"migrations",
				"001_initial.sql",
			),
			"utf8",
		),
	},
	{
		version: 2,
		name: "media_content_hash",
		sql: readFileSync(
			join(
				dirname(fileURLToPath(import.meta.url)),
				"migrations",
				"002_media_content_hash.sql",
			),
			"utf8",
		),
	},
	{
		version: 3,
		name: "media_time_zones",
		sql: readFileSync(
			join(
				dirname(fileURLToPath(import.meta.url)),
				"migrations",
				"003_media_time_zones.sql",
			),
			"utf8",
		),
	},
];

function checksum(sql: string): string {
	return createHash("sha256").update(sql).digest("hex");
}

export function runMigrations(db: Database): void {
	db.exec("PRAGMA foreign_keys = ON");
	db.exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			checksum TEXT NOT NULL,
			applied_at TEXT NOT NULL
		)
	`);

	const findApplied = db.query<AppliedMigration, [number]>(
		"SELECT version, name, checksum FROM schema_migrations WHERE version = ?",
	);
	const recordApplied = db.query<unknown, [number, string, string, string]>(
		"INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
	);

	for (const migration of migrations) {
		const expectedChecksum = checksum(migration.sql);
		const applied = findApplied.get(migration.version);
		if (applied) {
			if (
				applied.name !== migration.name ||
				applied.checksum !== expectedChecksum
			) {
				throw new Error(
					`Migration ${migration.version} (${migration.name}) differs from the applied migration`,
				);
			}
			continue;
		}

		db.exec("BEGIN IMMEDIATE");
		try {
			// Recheck under the write lock in case another process just migrated.
			const concurrentlyApplied = findApplied.get(migration.version);
			if (!concurrentlyApplied) {
				db.exec(migration.sql);
				recordApplied.run(
					migration.version,
					migration.name,
					expectedChecksum,
					new Date().toISOString(),
				);
			}
			db.exec("COMMIT");
		} catch (error) {
			db.exec("ROLLBACK");
			throw error;
		}
	}
}

export interface OpenDatabaseOptions {
	migrate?: boolean;
	readonly?: boolean;
}

export function openDatabase(
	databasePath: string,
	options: OpenDatabaseOptions = {},
): Database {
	if (databasePath !== ":memory:" && !options.readonly) {
		mkdirSync(dirname(databasePath), { recursive: true });
	}

	const db = new Database(databasePath, {
		create: !options.readonly,
		readonly: options.readonly ?? false,
	});
	try {
		db.exec("PRAGMA foreign_keys = ON");
		db.exec("PRAGMA busy_timeout = 5000");
		if (databasePath !== ":memory:" && !options.readonly) {
			db.exec("PRAGMA journal_mode = WAL");
		}

		if (options.migrate !== false) {
			if (options.readonly) {
				throw new Error("Cannot run migrations on a read-only database");
			}
			runMigrations(db);
		}
	} catch (error) {
		db.close();
		throw error;
	}

	return db;
}
