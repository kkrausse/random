import { NextRequest, NextResponse, connection } from "next/server";
import { db } from "@/db";
import { sightings } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { getUserByUsername } from "@/lib/users";
import { computeTrips } from "@/lib/trips";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  await connection();
  const { username } = await params;

  const user = await getUserByUsername(username);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const [counts] = await db
    .select({
      sightingCount: sql<number>`count(*)`,
      lifeListCount: sql<number>`count(distinct ${sightings.speciesCode})`,
    })
    .from(sightings)
    .where(eq(sightings.userId, user.id));

  const userSightings = await db
    .select()
    .from(sightings)
    .where(eq(sightings.userId, user.id));

  const tripCount = computeTrips(userSightings).length;

  return NextResponse.json({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    lifeListCount: counts.lifeListCount,
    tripCount,
    sightingCount: counts.sightingCount,
  });
}
