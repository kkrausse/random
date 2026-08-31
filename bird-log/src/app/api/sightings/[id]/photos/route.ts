import { NextRequest, NextResponse, connection } from "next/server";
import { db } from "@/db";
import { sightings, photos } from "@/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { promoteStagedUpload, storeUploadedFile } from "@/lib/uploads";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connection();
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const sightingId = parseInt(id);

  const sighting = await db
    .select()
    .from(sightings)
    .where(eq(sightings.id, sightingId))
    .get();

  if (!sighting) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (sighting.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  let uploadedPhotoIds: string[] = [];
  let photoFiles: File[] = [];

  if (contentType.includes("application/json")) {
    const body = await req.json();
    uploadedPhotoIds = Array.isArray(body.uploadedPhotoIds) ? body.uploadedPhotoIds : [];
  } else {
    const formData = await req.formData();
    photoFiles = formData.getAll("photos") as File[];
  }

  if (uploadedPhotoIds.length === 0 && photoFiles.length === 0) {
    return NextResponse.json({ error: "No photos provided" }, { status: 400 });
  }

  const newPhotos = [];
  for (const uploadedPhotoId of uploadedPhotoIds) {
    let photoFile;
    try {
      photoFile = await promoteStagedUpload(userId, uploadedPhotoId);
    } catch {
      return NextResponse.json({ error: "One or more uploaded photos could not be found" }, { status: 400 });
    }
    const [photo] = await db
      .insert(photos)
      .values({ sightingId, ...photoFile })
      .returning();
    newPhotos.push(photo);
  }

  for (const file of photoFiles) {
    if (!(file instanceof File) || file.size === 0) continue;
    const photoFile = await storeUploadedFile(file);
    const [photo] = await db
      .insert(photos)
      .values({ sightingId, ...photoFile })
      .returning();
    newPhotos.push(photo);
  }

  return NextResponse.json(newPhotos, { status: 201 });
}
