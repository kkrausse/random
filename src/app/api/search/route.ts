import { NextRequest, NextResponse, connection } from "next/server";
import { db } from "@/db";
import { sightings, photos } from "@/db/schema";
import { and, or, eq, like, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  await connection();
  const q = req.nextUrl.searchParams.get("q") || "";
  if (q.length < 1) {
    return NextResponse.json([]);
  }
  const userId = req.nextUrl.searchParams.get("userId");

  const rows = await db
    .select()
    .from(sightings)
    .where(
      and(
        userId ? eq(sightings.userId, userId) : undefined,
        or(
          like(sightings.species, `%${q}%`),
          like(sightings.notes, `%${q}%`),
          like(sightings.locationName, `%${q}%`)
        )
      )
    )
    .orderBy(desc(sightings.date));

  const allPhotos = await db.select().from(photos);
  const photoMap = new Map<number, typeof allPhotos>();
  for (const p of allPhotos) {
    const list = photoMap.get(p.sightingId) ?? [];
    list.push(p);
    photoMap.set(p.sightingId, list);
  }

  const result = rows.map((r) => ({
    ...r,
    photos: photoMap.get(r.id) ?? [],
  }));

  return NextResponse.json(result);
}
