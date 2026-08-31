import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { db } from "@/db";
import { photoComments, photoLikes, photos, sightings } from "@/db/schema";
import { eq, and, asc, inArray, isNull, sql } from "drizzle-orm";
import { getUserByUsername } from "@/lib/users";
import PhotoGrid from "@/components/PhotoGrid";
import { shuffle } from "@/lib/shuffle";

export default function UserSpeciesPage({
  params,
}: {
  params: Promise<{ username: string; speciesCode: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="p-4 max-w-2xl mx-auto">
          <div className="h-4 w-20 bg-gray-200 rounded animate-pulse mb-4" />
          <div className="h-8 w-40 bg-gray-200 rounded animate-pulse mb-2" />
          <div className="h-4 w-32 bg-gray-200 rounded animate-pulse mb-6" />
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="w-full h-48 bg-gray-200 rounded-lg animate-pulse" />
            ))}
          </div>
        </div>
      }
    >
      <UserSpeciesContent params={params} />
    </Suspense>
  );
}

async function UserSpeciesContent({
  params,
}: {
  params: Promise<{ username: string; speciesCode: string }>;
}) {
  await connection();
  const { userId: currentUserId } = await auth();
  const { username, speciesCode } = await params;

  const user = await getUserByUsername(username);
  if (!user) notFound();

  const userSightings = await db
    .select()
    .from(sightings)
    .where(and(eq(sightings.userId, user.id), eq(sightings.speciesCode, speciesCode)))
    .orderBy(asc(sightings.date), asc(sightings.createdAt));

  if (userSightings.length === 0) notFound();

  const liferDate = userSightings[0].date;
  const speciesName = userSightings[0].species;

  const sightingIds = userSightings.map((s) => s.id);
  const allPhotos = await db
    .select()
    .from(photos)
    .where(inArray(photos.sightingId, sightingIds));
  const photoIds = allPhotos.map((photo) => photo.id);

  const photoLikeCountRows = photoIds.length
    ? await db
        .select({
          photoId: photoLikes.photoId,
          likeCount: sql<number>`count(*)`,
        })
        .from(photoLikes)
        .where(inArray(photoLikes.photoId, photoIds))
        .groupBy(photoLikes.photoId)
    : [];

  const photoCommentCountRows = photoIds.length
    ? await db
        .select({
          photoId: photoComments.photoId,
          commentCount: sql<number>`count(*)`,
        })
        .from(photoComments)
        .where(
          and(
            inArray(photoComments.photoId, photoIds),
            isNull(photoComments.deletedAt)
          )
        )
        .groupBy(photoComments.photoId)
    : [];

  const currentUserPhotoLikeRows =
    currentUserId && photoIds.length
      ? await db
          .select({
            photoId: photoLikes.photoId,
          })
          .from(photoLikes)
          .where(
            and(
              eq(photoLikes.userId, currentUserId),
              inArray(photoLikes.photoId, photoIds)
            )
          )
      : [];

  const photoLikeCounts = new Map(
    photoLikeCountRows.map((row) => [row.photoId, row.likeCount])
  );
  const photoCommentCounts = new Map(
    photoCommentCountRows.map((row) => [row.photoId, row.commentCount])
  );
  const currentUserPhotoLikes = new Set(
    currentUserPhotoLikeRows.map((row) => row.photoId)
  );

  const photoMap = new Map<number, typeof allPhotos>();
  for (const p of allPhotos) {
    const list = photoMap.get(p.sightingId) ?? [];
    list.push(p);
    photoMap.set(p.sightingId, list);
  }

  const photoItems = shuffle(userSightings.flatMap((s) => {
    const sPhotos = photoMap.get(s.id) ?? [];
    return sPhotos.map((p) => ({
      photoId: p.id,
      sightingId: s.id,
      species: s.species,
      date: s.date,
      locationName: s.locationName,
      photoFilename: p.filename,
      username: user.username,
      width: p.width ?? undefined,
      height: p.height ?? undefined,
      likeCount: photoLikeCounts.get(p.id) ?? 0,
      commentCount: photoCommentCounts.get(p.id) ?? 0,
      likedByCurrentUser: currentUserPhotoLikes.has(p.id),
    }));
  }));

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="mb-4 flex items-center justify-between">
        <Link
          href={`/user/${username}/checklist`}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← Back to my checklist
        </Link>
        <Link
          href={`/species/${speciesCode}`}
          className="text-sm text-blue-600 hover:underline"
        >
          View all sightings on the site
        </Link>
      </div>

      <h1 className="text-2xl font-bold mb-1">{speciesName}</h1>
      <p className="text-sm text-gray-500 mb-1">
        First seen by {user.displayName} on{" "}
        <span className="font-medium">{liferDate}</span>
      </p>
      <p className="text-sm text-gray-500 mb-4">
        {userSightings.length} sighting{userSightings.length !== 1 ? "s" : ""}
        {photoItems.length > 0
          ? `, ${photoItems.length} photo${photoItems.length !== 1 ? "s" : ""}`
          : ""}
      </p>

      {photoItems.length === 0 ? (
        <p className="text-gray-500 py-8 text-center">No photos for this species yet.</p>
      ) : (
        <PhotoGrid items={photoItems} singleColumn />
      )}
    </div>
  );
}
