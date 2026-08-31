// Schema workflow: edit schema.ts → bun run db:generate → bun run db:migrate
// (drizzle-kit push is not used — better-sqlite3 doesn't work in Bun)
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
// Don't set foreign_keys=ON here — migrations run inside a transaction where
// PRAGMA foreign_keys cannot be changed. The app (src/db/index.ts) sets it ON
// for normal operation. Each migration manages its own FK state via PRAGMA statements.

const db = drizzle(sqlite);

migrate(db, { migrationsFolder: "./drizzle" });

console.log("Migrations applied successfully");
