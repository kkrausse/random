import { NextRequest, NextResponse, connection } from "next/server";
import { db } from "@/db";
import { sightings, photos } from "@/db/schema";
import { desc, eq, and, gte, lte, like } from "drizzle-orm";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { v4 as uuid } from "uuid";
import { auth } from "@clerk/nextjs/server";
import { imageSize } from "image-size";

export async function GET(req: NextRequest) {
  await connection();
  const url = req.nextUrl;
  const species = url.searchParams.get("species");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const userId = url.searchParams.get("userId");

  const conditions = [];
  if (species) conditions.push(like(sightings.species, `%${species}%`));
  if (from) conditions.push(gte(sightings.date, from));
  if (to) conditions.push(lte(sightings.date, to));
  if (userId) conditions.push(eq(sightings.userId, userId));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(sightings)
    .where(where)
    .orderBy(desc(sightings.date), desc(sightings.createdAt));

  // Fetch photos for each sighting
  const sightingIds = rows.map((r) => r.id);
  const allPhotos =
    sightingIds.length > 0
      ? await db.select().from(photos)
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

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();

  const species = formData.get("species") as string;
  const speciesCode = formData.get("speciesCode") as string;
  const date = formData.get("date") as string;
  const lat = parseFloat(formData.get("lat") as string);
  const lng = parseFloat(formData.get("lng") as string);
  const locationName = formData.get("locationName") as string;
  const notes = (formData.get("notes") as string) || "";

  if (!species || !speciesCode || !date || isNaN(lat) || isNaN(lng) || !locationName) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const [sighting] = await db
    .insert(sightings)
    .values({ species, speciesCode, date, lat, lng, locationName, notes, userId })
    .returning();

  // Handle photo uploads
  const photoFiles = formData.getAll("photos") as File[];
  const uploadDir = process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.join(process.cwd(), "uploads");
  await mkdir(uploadDir, { recursive: true });

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

    await db.insert(photos).values({ sightingId: sighting.id, filename, width, height });
  }

  const sightingPhotos = await db
    .select()
    .from(photos)
    .where(eq(photos.sightingId, sighting.id));

  return NextResponse.json({ ...sighting, photos: sightingPhotos }, { status: 201 });
}
