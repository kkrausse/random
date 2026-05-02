// NOTE: drizzle-kit's CLI (e.g. `drizzle-kit push`) is built around `better-sqlite3`,
// which is a Node.js native C++ addon and does not work in Bun.
// We use `drizzle-orm/bun-sqlite/migrator` instead, which is the official programmatic
// migrator for the Bun SQLite runtime. See: https://github.com/drizzle-team/drizzle-orm/issues/1740
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import path from "path";
import { mkdirSync } from "fs";

const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(process.cwd(), "data", "bird-log.db");

mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.run("PRAGMA journal_mode = WAL;");
sqlite.run("PRAGMA foreign_keys = ON;");

const db = drizzle(sqlite);

migrate(db, { migrationsFolder: "./drizzle" });

console.log("Migrations applied successfully");
