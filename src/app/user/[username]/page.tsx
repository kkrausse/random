import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { sightings, photos } from "@/db/schema";
import { eq, desc, inArray } from "drizzle-orm";
import { getUserByUsername } from "@/lib/users";
import { computeTrips } from "@/lib/trips";
import PhotoGrid from "@/components/PhotoGrid";
import PhotoGridSkeleton from "@/components/PhotoGridSkeleton";

export default function UserHomePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  return (
    <Suspense fallback={<PhotoGridSkeleton />}>
      <UserHomeContent params={params} />
    </Suspense>
  );
}

async function UserHomeContent({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  await connection();
  const { userId: viewerId } = await auth();
  const { username } = await params;

  const user = await getUserByUsername(username);
  if (!user) notFound();

  const userSightings = await db
    .select()
    .from(sightings)
    .where(eq(sightings.userId, user.id))
    .orderBy(desc(sightings.date), desc(sightings.createdAt));

  const lifeListCount = new Set(userSightings.map((s) => s.speciesCode)).size;
  const tripCount = computeTrips(userSightings).length;

  const sightingIds = userSightings.map((s) => s.id);
  const userPhotos =
    sightingIds.length > 0
      ? await db
          .select()
          .from(photos)
          .where(inArray(photos.sightingId, sightingIds))
      : [];

  const photoMap = new Map<number, typeof userPhotos>();
  for (const p of userPhotos) {
    const list = photoMap.get(p.sightingId) ?? [];
    list.push(p);
    photoMap.set(p.sightingId, list);
  }

  const photoItems = userSightings.flatMap((s) => {
    const sPhotos = photoMap.get(s.id) ?? [];
    return sPhotos.map((p) => ({
      sightingId: s.id,
      species: s.species,
      date: s.date,
      locationName: s.locationName,
      photoFilename: p.filename,
      width: p.width ?? undefined,
      height: p.height ?? undefined,
    }));
  });

  for (let i = photoItems.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [photoItems[i], photoItems[j]] = [photoItems[j], photoItems[i]];
  }

  const isOwner = viewerId === user.id;

  return (
    <div className="p-4">
      <div className="max-w-2xl mx-auto mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">{user.displayName}</h1>
            <p className="text-gray-500 text-sm">@{user.username}</p>
          </div>
          {isOwner && (
            <Link
              href={`/user/${username}/edit`}
              className="text-sm text-blue-600 hover:underline"
            >
              Edit Profile
            </Link>
          )}
        </div>
        <div className="flex gap-6 mt-3 text-sm text-gray-600">
          <span>
            <span className="font-semibold text-gray-900">{lifeListCount}</span>{" "}
            lifers
          </span>
          <span>
            <span className="font-semibold text-gray-900">{tripCount}</span>{" "}
            trips
          </span>
          <span>
            <span className="font-semibold text-gray-900">
              {userSightings.length}
            </span>{" "}
            sightings
          </span>
        </div>
      </div>

      {photoItems.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <p className="text-lg mb-2">No photos yet.</p>
          {isOwner && (
            <Link href="/add" className="text-green-600 hover:underline">
              Log a sighting with a photo!
            </Link>
          )}
        </div>
      ) : (
        <PhotoGrid items={photoItems} />
      )}
    </div>
  );
}
