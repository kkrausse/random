import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { createClerkClient } from "@clerk/nextjs/server";
import { and, ne, sql } from "drizzle-orm";
import * as schema from "../src/db/schema";
import {
  type ClerkUserMirrorSource,
  deriveAvailableMirroredUsername,
  deriveMirroredDisplayName,
  mirroredProfileImageUrl,
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

function usernameExistsForAnotherUser(candidate: string, userId: string): boolean {
  return Boolean(db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(sql`lower(${schema.users.username}) = lower(${candidate})`, ne(schema.users.id, userId)))
    .get());
}

function getExistingUser(userId: string) {
  return db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
      profileImageUrl: schema.users.profileImageUrl,
    })
    .from(schema.users)
    .where(sql`${schema.users.id} = ${userId}`)
    .get();
}

const sightingUserIds = db
  .selectDistinct({ userId: schema.sightings.userId })
  .from(schema.sightings)
  .all()
  .map(({ userId }) => userId);

const existingUserIds = db
  .select({ userId: schema.users.id })
  .from(schema.users)
  .all()
  .map(({ userId }) => userId);

const userIds = [...new Set([...sightingUserIds, ...existingUserIds])].sort();

console.log(
  `Found ${userIds.length} user id(s) from sightings/users (${sightingUserIds.length} in sightings, ${existingUserIds.length} existing user rows)`
);

let inserted = 0;
let updated = 0;
let unchanged = 0;
let lookupFailed = 0;

for (const userId of userIds) {
  const existing = getExistingUser(userId);
  let source: ClerkUserMirrorSource;

  try {
    const clerkUser = await clerk.users.getUser(userId);
    source = {
      id: clerkUser.id,
      username: clerkUser.username,
      imageUrl: clerkUser.imageUrl,
      firstName: clerkUser.firstName,
      lastName: clerkUser.lastName,
    };
  } catch {
    lookupFailed++;
    if (existing) {
      console.warn(`  ${userId}: Clerk lookup failed, leaving existing row unchanged`);
      unchanged++;
      continue;
    }

    console.warn(`  ${userId}: Clerk lookup failed, inserting placeholder`);
    source = { id: userId, username: null };
  }

  const username = await deriveAvailableMirroredUsername(source, (candidate) =>
    usernameExistsForAnotherUser(candidate, userId)
  );
  const displayName = deriveMirroredDisplayName(source);
  const profileImageUrl = mirroredProfileImageUrl(source);

  if (existing) {
    if (
      existing.username === username &&
      existing.displayName === displayName &&
      existing.profileImageUrl === profileImageUrl
    ) {
      console.log(`  ${userId}: already current as @${username} (${displayName})`);
      unchanged++;
      continue;
    }

    db.update(schema.users)
      .set({ username, displayName, profileImageUrl })
      .where(sql`${schema.users.id} = ${userId}`)
      .run();

    console.log(
      `  ${userId}: updated @${existing.username} (${existing.displayName}) -> @${username} (${displayName})`
    );
    updated++;
    continue;
  }

  db.insert(schema.users)
    .values({ id: userId, username, displayName, profileImageUrl })
    .run();

  console.log(`  ${userId}: inserted as @${username} (${displayName})`);
  inserted++;
}

console.log(
  `\nDone. inserted=${inserted} updated=${updated} unchanged=${unchanged} lookupFailed=${lookupFailed}`
);
sqlite.close();
