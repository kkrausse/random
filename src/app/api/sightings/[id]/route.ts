import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sightings, photos } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { unlink } from "fs/promises";
import path from "path";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
  const { id } = await params;
  const body = await req.json();

  // Delete removed photos
  const removedPhotoIds: number[] = body.removedPhotoIds || [];
  if (removedPhotoIds.length > 0) {
    const toDelete = await db
      .select()
      .from(photos)
      .where(inArray(photos.id, removedPhotoIds));
    for (const photo of toDelete) {
      try {
        await unlink(path.join(process.cwd(), "uploads", photo.filename));
      } catch {
        // File may already be deleted
      }
    }
    await db.delete(photos).where(inArray(photos.id, removedPhotoIds));
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
    .where(eq(sightings.id, parseInt(id)))
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
  const { id } = await params;

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
    .where(eq(sightings.id, parseInt(id)))
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
