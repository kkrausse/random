import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { sightings } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getUserByUsername } from "@/lib/users";
import { computeTrips } from "@/lib/trips";
import { userChecklistRoute, userTripsRoute } from "@/lib/routes";
import { parsePhotoSort } from "@/lib/photo-sort";
import PhotoGridLoader from "@/components/PhotoGridLoader";
import PhotoGridSkeleton from "@/components/PhotoGridSkeleton";
import UserAvatar from "@/components/UserAvatar";

export default function UserHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams?: Promise<{ sort?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<PhotoGridSkeleton />}>
      <UserHomeContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function UserHomeContent({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams?: Promise<{ sort?: string | string[] }>;
}) {
  await connection();
  const { userId: viewerId } = await auth();
  const { username } = await params;
  const sort = parsePhotoSort((await searchParams)?.sort);

  const user = await getUserByUsername(username);
  if (!user) notFound();

  const userSightings = await db
    .select()
    .from(sightings)
    .where(eq(sightings.userId, user.id))
    .orderBy(desc(sightings.date), desc(sightings.createdAt));

  const lifeListCount = new Set(userSightings.map((s) => s.speciesCode)).size;
  const tripCount = computeTrips(userSightings).length;

  const isOwner = viewerId === user.id;

  return (
    <div className="p-4">
      <div className="max-w-2xl mx-auto mb-6">
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <UserAvatar
              imageUrl={user.profileImageUrl}
              displayName={user.displayName}
              username={user.username}
              size="lg"
            />
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold">{user.displayName}</h1>
              <p className="text-sm text-gray-500">@{user.username}</p>
              {isOwner && (
                <Link
                  href={`/user/${username}/edit`}
                  className="mt-1 inline-block text-sm text-blue-600 hover:underline"
                >
                  Edit Profile
                </Link>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-6 mt-3 text-sm text-gray-600">
          <Link
            href={userChecklistRoute(username)}
            className="text-blue-600 hover:underline"
          >
            <span className="font-semibold text-gray-900">{lifeListCount}</span>{" "}
            lifers
          </Link>
          <Link
            href={userTripsRoute(username)}
            className="text-blue-600 hover:underline"
          >
            <span className="font-semibold text-gray-900">{tripCount}</span>{" "}
            trips
          </Link>
          <span>
            <span className="font-semibold text-gray-900">
              {userSightings.length}
            </span>{" "}
            sightings
          </span>
        </div>
        {user.bio && (
          <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-gray-700">
            {user.bio}
          </p>
        )}
      </div>

      <Suspense fallback={<PhotoGridSkeleton />}>
        <PhotoGridLoader userId={user.id} emptyElement={isOwner ? (
          <div className="text-center py-20 text-gray-500">
            <p className="text-lg mb-2">No photos yet.</p>
            <Link href="/add" className="text-green-600 hover:underline">
              Log a sighting with a photo!
            </Link>
          </div>
        ) : undefined} sort={sort} />
      </Suspense>
    </div>
  );
}
