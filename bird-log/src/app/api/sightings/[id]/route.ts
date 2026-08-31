import { NextRequest, NextResponse, connection } from "next/server";
import { db } from "@/db";
import { sightings, photos } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { unlink } from "fs/promises";
import path from "path";
import { auth } from "@clerk/nextjs/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connection();
  const { id } = await params;
  const sighting = await db
    .select()
    .from(sightings)
    .where(eq(sightings.id, parseInt(id)))
    .get();

  if (!sighting) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sightingPhotos = await db
    .select()
    .from(photos)
    .where(eq(photos.sightingId, sighting.id));

  return NextResponse.json({ ...sighting, photos: sightingPhotos });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const existing = await db
    .select()
    .from(sightings)
    .where(eq(sightings.id, parseInt(id)))
    .get();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.userId !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();

  // Delete removed photos
  const removedPhotoIds: number[] = body.removedPhotoIds || [];
  if (removedPhotoIds.length > 0) {
    const toDelete = await db
      .select()
      .from(photos)
      .where(
        and(
          eq(photos.sightingId, existing.id),
          inArray(photos.id, removedPhotoIds)
        )
      );
    for (const photo of toDelete) {
      try {
        await unlink(path.join(process.cwd(), "uploads", photo.filename));
      } catch {
        // File may already be deleted
      }
    }
    await db
      .delete(photos)
      .where(
        and(
          eq(photos.sightingId, existing.id),
          inArray(photos.id, removedPhotoIds)
        )
      );
  }

  const [updated] = await db
    .update(sightings)
    .set({
      species: body.species,
      speciesCode: body.speciesCode,
      date: body.date,
      lat: body.lat,
      lng: body.lng,
      locationName: body.locationName,
      notes: body.notes,
    })
    .where(and(eq(sightings.id, parseInt(id)), eq(sightings.userId, userId)))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const existing = await db
    .select()
    .from(sightings)
    .where(eq(sightings.id, parseInt(id)))
    .get();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.userId !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Delete photo files from disk
  const sightingPhotos = await db
    .select()
    .from(photos)
    .where(eq(photos.sightingId, parseInt(id)));

  for (const photo of sightingPhotos) {
    try {
      await unlink(path.join(process.cwd(), "uploads", photo.filename));
    } catch {
      // File may already be deleted
    }
  }

  const [deleted] = await db
    .delete(sightings)
    .where(and(eq(sightings.id, parseInt(id)), eq(sightings.userId, userId)))
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
