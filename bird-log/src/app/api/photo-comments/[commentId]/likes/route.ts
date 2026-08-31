import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { photoCommentLikes, photoComments, photos } from "@/db/schema";

async function getCommentWithPhoto(commentId: number) {
  return db
    .select({
      id: photoComments.id,
      userId: photoComments.userId,
      deletedAt: photoComments.deletedAt,
      sightingId: photos.sightingId,
    })
    .from(photoComments)
    .innerJoin(photos, eq(photoComments.photoId, photos.id))
    .where(eq(photoComments.id, commentId))
    .get();
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ commentId: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { commentId: rawCommentId } = await params;
  const commentId = Number(rawCommentId);

  if (!Number.isInteger(commentId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const comment = await getCommentWithPhoto(commentId);
  if (!comment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (comment.deletedAt) {
    return NextResponse.json(
      { error: "Cannot like a deleted comment" },
      { status: 400 }
    );
  }

  if (comment.userId === userId) {
    return NextResponse.json(
      { error: "You cannot like your own comment" },
      { status: 403 }
    );
  }

  await db
    .insert(photoCommentLikes)
    .values({ commentId, userId })
    .onConflictDoNothing({
      target: [photoCommentLikes.commentId, photoCommentLikes.userId],
    });

  revalidatePath(`/sighting/${comment.sightingId}`);
  return NextResponse.json({ liked: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ commentId: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { commentId: rawCommentId } = await params;
  const commentId = Number(rawCommentId);

  if (!Number.isInteger(commentId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const comment = await getCommentWithPhoto(commentId);
  if (!comment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db
    .delete(photoCommentLikes)
    .where(
      and(
        eq(photoCommentLikes.commentId, commentId),
        eq(photoCommentLikes.userId, userId)
      )
    );

  revalidatePath(`/sighting/${comment.sightingId}`);
  return NextResponse.json({ liked: false });
}
