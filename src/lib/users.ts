// URL strategy: /user/[username] (not /user/[clerkId]) — usernames are human-readable
// and stable enough for sharing. Clerk IDs are the internal PK; usernames are the public identifier.

import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export type UserRow = typeof users.$inferSelect;

export async function getUserByUsername(username: string): Promise<UserRow | null> {
  const rows = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return rows[0] ?? null;
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

// Accepts either a Clerk user id (starts with "user_") or a username string.
export async function resolveUserParam(param: string): Promise<UserRow | null> {
  if (param.startsWith("user_")) {
    return getUserById(param);
  }
  return getUserByUsername(param);
}
