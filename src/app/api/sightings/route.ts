import { NextRequest, NextResponse, connection } from "next/server";
import { db } from "@/db";
import { sightings, photos, users } from "@/db/schema";
import { desc, eq, and, gte, lte, like, inArray } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { promoteStagedUpload, storeUploadedFile, type StoredPhotoFile } from "@/lib/uploads";

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
    .where(where)
    .orderBy(desc(sightings.date), desc(sightings.createdAt));

  // Fetch photos for each sighting
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

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contentType = req.headers.get("content-type") ?? "";
  let species: string;
  let speciesCode: string;
  let date: string;
  let lat: number;
  let lng: number;
  let locationName: string;
  let notes: string;
  let uploadedPhotoIds: string[] = [];
  let photoFiles: File[] = [];

  if (contentType.includes("application/json")) {
    const body = await req.json();
    species = body.species;
    speciesCode = body.speciesCode;
    date = body.date;
    lat = Number(body.lat);
    lng = Number(body.lng);
    locationName = body.locationName;
    notes = body.notes || "";
    uploadedPhotoIds = Array.isArray(body.uploadedPhotoIds) ? body.uploadedPhotoIds : [];
  } else {
    const formData = await req.formData();
    species = formData.get("species") as string;
    speciesCode = formData.get("speciesCode") as string;
    date = formData.get("date") as string;
    lat = parseFloat(formData.get("lat") as string);
    lng = parseFloat(formData.get("lng") as string);
    locationName = formData.get("locationName") as string;
    notes = (formData.get("notes") as string) || "";
    photoFiles = formData.getAll("photos") as File[];
  }

  if (!species || !speciesCode || !date || isNaN(lat) || isNaN(lng) || !locationName) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const photoFilesToAttach: StoredPhotoFile[] = [];
  try {
    for (const uploadedPhotoId of uploadedPhotoIds) {
      photoFilesToAttach.push(await promoteStagedUpload(userId, uploadedPhotoId));
    }
  } catch {
    return NextResponse.json({ error: "One or more uploaded photos could not be found" }, { status: 400 });
  }

  for (const file of photoFiles) {
    if (!(file instanceof File) || file.size === 0) continue;
    photoFilesToAttach.push(await storeUploadedFile(file));
  }

  const [sighting] = await db
    .insert(sightings)
    .values({ species, speciesCode, date, lat, lng, locationName, notes, userId })
    .returning();

  for (const photo of photoFilesToAttach) {
    await db.insert(photos).values({ sightingId: sighting.id, ...photo });
  }

  const sightingPhotos = await db
    .select()
    .from(photos)
    .where(eq(photos.sightingId, sighting.id));

  return NextResponse.json({ ...sighting, photos: sightingPhotos }, { status: 201 });
}
