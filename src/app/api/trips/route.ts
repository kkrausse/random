import { NextRequest, NextResponse, connection } from "next/server";
import { db } from "@/db";
import { sightings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { computeTrips } from "@/lib/trips";

export async function GET(req: NextRequest) {
  await connection();
  const userId = req.nextUrl.searchParams.get("userId");

  const rows = await db
    .select()
    .from(sightings)
    .where(userId ? eq(sightings.userId, userId) : undefined);

  const trips = computeTrips(rows);
  return NextResponse.json(trips);
}
