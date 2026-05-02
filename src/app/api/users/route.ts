import { NextResponse, connection } from "next/server";
import { db } from "@/db";
import { users, sightings } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export async function GET() {
  await connection();

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      sightingCount: sql<number>`count(${sightings.id})`,
      lifeListCount: sql<number>`count(distinct ${sightings.speciesCode})`,
      lastActivity: sql<string | null>`max(${sightings.createdAt})`,
    })
    .from(users)
    .leftJoin(sightings, eq(sightings.userId, users.id))
    .groupBy(users.id)
    .orderBy(sql`max(${sightings.createdAt}) desc nulls last`);

  return NextResponse.json(rows);
}
