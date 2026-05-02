import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sightings, photos } from "@/db/schema";
import { eq } from "drizzle-orm";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { v4 as uuid } from "uuid";
import { auth } from "@clerk/nextjs/server";
import { imageSize } from "image-size";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const formData = await req.formData();
  const photoFiles = formData.getAll("photos") as File[];

  if (photoFiles.length === 0) {
    return NextResponse.json({ error: "No photos provided" }, { status: 400 });
  }

  const uploadDir = process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.join(process.cwd(), "uploads");
  await mkdir(uploadDir, { recursive: true });

  const newPhotos = [];
  for (const file of photoFiles) {
    if (!(file instanceof File) || file.size === 0) continue;
    const ext = file.name.split(".").pop() || "jpg";
    const filename = `${uuid()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(uploadDir, filename), buffer);

    let width: number | undefined;
    let height: number | undefined;
    try {
      const dims = imageSize(buffer);
      width = dims.width;
      height = dims.height;
    } catch {
      // ignore dimension extraction errors
    }

    const [photo] = await db
      .insert(photos)
      .values({ sightingId, filename, width, height })
      .returning();
    newPhotos.push(photo);
  }

  return NextResponse.json(newPhotos, { status: 201 });
}
