import { NextResponse } from "next/server";
import { db } from "@/db";
import { sightings } from "@/db/schema";
import { sql } from "drizzle-orm";

export async function GET() {
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
