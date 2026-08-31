import { NextRequest, NextResponse, connection } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { photoLikes, photos, users } from "@/db/schema";

async function getPhoto(photoId: number) {
  return db.select().from(photos).where(eq(photos.id, photoId)).get();
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ photoId: string }> }
) {
  await connection();
  const { photoId: rawPhotoId } = await params;
  const photoId = Number(rawPhotoId);

  if (!Number.isInteger(photoId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const photo = await getPhoto(photoId);
  if (!photo) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const likers = await db
    .select({
      userId: users.id,
      username: users.username,
      displayName: users.displayName,
      createdAt: photoLikes.createdAt,
    })
    .from(photoLikes)
    .innerJoin(users, eq(photoLikes.userId, users.id))
    .where(eq(photoLikes.photoId, photoId));

  return NextResponse.json({ photoId, likers });
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ photoId: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { photoId: rawPhotoId } = await params;
  const photoId = Number(rawPhotoId);

  if (!Number.isInteger(photoId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const photo = await getPhoto(photoId);
  if (!photo) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db
    .insert(photoLikes)
    .values({ photoId, userId })
    .onConflictDoNothing({
      target: [photoLikes.photoId, photoLikes.userId],
    });

  revalidatePath(`/sighting/${photo.sightingId}`);
  return NextResponse.json({ liked: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ photoId: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { photoId: rawPhotoId } = await params;
  const photoId = Number(rawPhotoId);

  if (!Number.isInteger(photoId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const photo = await getPhoto(photoId);
  if (!photo) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db
    .delete(photoLikes)
    .where(and(eq(photoLikes.photoId, photoId), eq(photoLikes.userId, userId)));

  revalidatePath(`/sighting/${photo.sightingId}`);
  return NextResponse.json({ liked: false });
}
