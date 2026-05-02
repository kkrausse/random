import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { db } from "../src/db";

migrate(db, { migrationsFolder: "./drizzle" });
console.log("migrations complete");
