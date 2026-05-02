import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import * as schema from "./schema";
import path from "path";
import { mkdirSync } from "fs";

type DB = ReturnType<typeof drizzle<typeof schema>>;

let _db: DB | null = null;

function getDb(): DB {
  if (!_db) {
    const dbPath = process.env.DATABASE_PATH
      ? path.resolve(process.env.DATABASE_PATH)
      : path.join(process.cwd(), "data", "bird-log.db");
    mkdirSync(path.dirname(dbPath), { recursive: true });
    const sqlite = new Database(dbPath);
    sqlite.run("PRAGMA journal_mode = WAL;");
    sqlite.run("PRAGMA foreign_keys = ON;");
    _db = drizzle(sqlite, { schema });
  }
  return _db;
}

export const db = new Proxy({} as DB, {
  get(_, prop: string | symbol) {
    return (getDb() as any)[prop];
  },
});
