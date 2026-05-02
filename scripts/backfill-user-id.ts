import { Database } from "bun:sqlite";
import path from "path";

const userId = process.env.DEFAULT_USER_ID;
if (!userId) {
  console.error("DEFAULT_USER_ID env var is required");
  process.exit(1);
}

const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(process.cwd(), "data", "bird-log.db");

const db = new Database(dbPath);
const result = db.run("UPDATE sightings SET user_id = ? WHERE user_id IS NULL", [userId]);
console.log(`Backfilled ${result.changes} rows with user_id = ${userId}`);
db.close();
