import { NextRequest, NextResponse, connection } from "next/server";
import { db } from "@/db";
import { sightings, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { computeTrips } from "@/lib/trips";

export async function GET(req: NextRequest) {
  await connection();
  const userId = req.nextUrl.searchParams.get("userId");

  const rows = await db
    .select({
      id: sightings.id,
      species: sightings.species,
      speciesCode: sightings.speciesCode,
      date: sightings.date,
      lat: sightings.lat,
      lng: sightings.lng,
      locationName: sightings.locationName,
      notes: sightings.notes,
      userId: sightings.userId,
      createdAt: sightings.createdAt,
      username: users.username,
      displayName: users.displayName,
    })
    .from(sightings)
    .innerJoin(users, eq(sightings.userId, users.id))
    .where(userId ? eq(sightings.userId, userId) : undefined);

  const trips = computeTrips(rows);
  return NextResponse.json(trips);
}
