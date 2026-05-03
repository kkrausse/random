import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { photoComments, photos, users } from "@/db/schema";

const MAX_COMMENT_BODY_LENGTH = 2000;

export async function POST(
  req: NextRequest,
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

  const photo = await db
    .select()
    .from(photos)
    .where(eq(photos.id, photoId))
    .get();

  if (!photo) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const commentBody = typeof body?.body === "string" ? body.body.trim() : "";
  const parentId =
    body?.parentId === undefined || body?.parentId === null
      ? null
      : Number(body.parentId);

  if (!commentBody) {
    return NextResponse.json(
      { error: "Comment body is required" },
      { status: 400 }
    );
  }

  if (commentBody.length > MAX_COMMENT_BODY_LENGTH) {
    return NextResponse.json(
      { error: `Comment body must be ${MAX_COMMENT_BODY_LENGTH} characters or fewer` },
      { status: 400 }
    );
  }

  if (parentId !== null) {
    if (!Number.isInteger(parentId)) {
      return NextResponse.json(
        { error: "Parent comment was not found" },
        { status: 400 }
      );
    }

    const parent = await db
      .select({
        photoId: photoComments.photoId,
        deletedAt: photoComments.deletedAt,
      })
      .from(photoComments)
      .where(eq(photoComments.id, parentId))
      .get();

    if (!parent || parent.photoId !== photoId) {
      return NextResponse.json(
        { error: "Parent comment must belong to the same photo" },
        { status: 400 }
      );
    }

    if (parent.deletedAt) {
      return NextResponse.json(
        { error: "Cannot reply to a deleted comment" },
        { status: 400 }
      );
    }
  }

  const [comment] = await db
    .insert(photoComments)
    .values({
      photoId,
      userId,
      parentId,
      body: commentBody,
    })
    .returning();

  const author = await db
    .select({
      username: users.username,
      displayName: users.displayName,
      profileImageUrl: users.profileImageUrl,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  revalidatePath(`/sighting/${photo.sightingId}`);
  return NextResponse.json(
    {
      ...comment,
      author,
      likeCount: 0,
      likedByCurrentUser: false,
      replies: [],
    },
    { status: 201 }
  );
}
