import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { createClerkClient } from "@clerk/nextjs/server";
import { sql } from "drizzle-orm";
import * as schema from "../src/db/schema";
import {
  type ClerkUserMirrorSource,
  deriveAvailableMirroredUsername,
  deriveMirroredDisplayName,
} from "../src/lib/clerk-user-mirror";
import path from "path";

const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(process.cwd(), "data", "bird-log.db");

const sqlite = new Database(dbPath);
sqlite.run("PRAGMA journal_mode = WAL;");
sqlite.run("PRAGMA foreign_keys = ON;");
const db = drizzle(sqlite, { schema });

const secretKey = process.env.CLERK_SECRET_KEY;
if (!secretKey) {
  console.error("CLERK_SECRET_KEY env var is required");
  process.exit(1);
}

const clerk = createClerkClient({ secretKey });

const rows = db
  .selectDistinct({ userId: schema.sightings.userId })
  .from(schema.sightings)
  .all();

console.log(`Found ${rows.length} distinct user(s) in sightings`);

let inserted = 0;
let skipped = 0;

for (const { userId } of rows) {
  const existing = db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(sql`${schema.users.id} = ${userId}`)
    .get();

  if (existing) {
    console.log(`  ${userId}: already exists, skipping`);
    skipped++;
    continue;
  }

  let username: string | null = null;
  let displayName: string;
  let source: ClerkUserMirrorSource = { id: userId, username: null };

  try {
    const clerkUser = await clerk.users.getUser(userId);
    source = {
      id: clerkUser.id,
      username: clerkUser.username,
      firstName: clerkUser.firstName,
      lastName: clerkUser.lastName,
    };
    displayName = deriveMirroredDisplayName(source);
  } catch {
    console.warn(`  ${userId}: Clerk lookup failed, using placeholder`);
    displayName = `birder-${userId.slice(-6)}`;
  }

  username = await deriveAvailableMirroredUsername(source, (candidate) => {
    return Boolean(db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.username}) = lower(${candidate})`)
      .get());
  });

  db.insert(schema.users)
    .values({ id: userId, username, displayName })
    .run();

  console.log(`  ${userId}: inserted as @${username} (${displayName})`);
  inserted++;
}

console.log(`\nDone. inserted=${inserted} skipped=${skipped}`);
sqlite.close();
