import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { photoComments, photos } from "@/db/schema";

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

  const comment = await db
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

  if (!comment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (comment.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!comment.deletedAt) {
    const deletedAt = new Date().toISOString();
    await db
      .update(photoComments)
      .set({
        body: "",
        updatedAt: deletedAt,
        deletedAt,
      })
      .where(eq(photoComments.id, commentId));
  }

  revalidatePath(`/sighting/${comment.sightingId}`);
  return NextResponse.json({ deleted: true });
}
