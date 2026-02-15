import { NextResponse } from "next/server";
import { db } from "@/db";
import { sightings } from "@/db/schema";
import { computeTrips } from "@/lib/trips";

export async function GET() {
  const rows = await db.select().from(sightings);
  const trips = computeTrips(rows);
  return NextResponse.json(trips);
}
