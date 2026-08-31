import { NextResponse, connection } from "next/server";
import { db } from "@/db";
import { sightings } from "@/db/schema";
import { sql } from "drizzle-orm";

export async function GET() {
  await connection();
  const rows = await db
    .selectDistinct({
      locationName: sightings.locationName,
      lat: sightings.lat,
      lng: sightings.lng,
    })
    .from(sightings)
    .orderBy(sql`${sightings.locationName} asc`);

  return NextResponse.json(rows);
}
