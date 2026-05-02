import { NextRequest, NextResponse, connection } from "next/server";
import { db } from "@/db";
import { sightings, photos, users } from "@/db/schema";
import { and, or, eq, like, desc, inArray } from "drizzle-orm";

export async function GET(req: NextRequest) {
  await connection();
  const q = req.nextUrl.searchParams.get("q") || "";
  if (q.length < 1) {
    return NextResponse.json([]);
  }
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

  const sightingIds = rows.map((r) => r.id);
  const allPhotos =
    sightingIds.length > 0
      ? await db.select().from(photos).where(inArray(photos.sightingId, sightingIds))
      : [];
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
