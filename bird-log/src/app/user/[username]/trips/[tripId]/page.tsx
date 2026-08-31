import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { sightings, photos } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getUserByUsername } from "@/lib/users";
import { computeTrips } from "@/lib/trips";
import SightingCard from "@/components/SightingCard";
import { Button } from "@/components/ui/button";

export default function UserTripDetailPage({
  params,
}: {
  params: Promise<{ username: string; tripId: string }>;
}) {
  return (
    <Suspense fallback={<div className="p-4 text-center text-gray-500">Loading...</div>}>
      <UserTripDetailContent params={params} />
    </Suspense>
  );
}

async function UserTripDetailContent({
  params,
}: {
  params: Promise<{ username: string; tripId: string }>;
}) {
  await connection();
  const { userId: viewerId } = await auth();
  const { username, tripId } = await params;

  const user = await getUserByUsername(username);
  if (!user) notFound();

  const userSightings = await db
    .select()
    .from(sightings)
    .where(eq(sightings.userId, user.id));

  const trips = computeTrips(userSightings);
  const trip = trips.find((t) => t.id === decodeURIComponent(tripId));
  if (!trip) notFound();

  const sightingIds = trip.sightings.map((s) => s.id);
  const tripPhotos =
    sightingIds.length > 0
      ? await db.select().from(photos).where(inArray(photos.sightingId, sightingIds))
      : [];

  const photoMap = new Map<number, { id: number; filename: string }[]>();
  for (const p of tripPhotos) {
    const list = photoMap.get(p.sightingId) ?? [];
    list.push({ id: p.id, filename: p.filename });
    photoMap.set(p.sightingId, list);
  }

  const sightingsWithPhotos = trip.sightings.map((s) => ({
    ...s,
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    photos: photoMap.get(s.id) ?? [],
  }));

  const dateLabel =
    trip.startDate === trip.endDate
      ? trip.startDate
      : `${trip.startDate} to ${trip.endDate}`;

  const isOwner = viewerId === user.id;
  const firstSighting = trip.sightings[0];
  const addParams = new URLSearchParams({ date: trip.startDate, locationName: trip.locationName });
  if (firstSighting) {
    addParams.set("lat", String(firstSighting.lat));
    addParams.set("lng", String(firstSighting.lng));
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex items-start justify-between mb-1">
        <h1 className="text-2xl font-bold">{trip.locationName}</h1>
        {isOwner && (
          <Link href={`/add?${addParams.toString()}`}>
            <Button size="sm">+ Add Sighting</Button>
          </Link>
        )}
      </div>
      <p className="text-gray-500 mb-1">{dateLabel}</p>
      <p className="text-gray-600 mb-1">
        {trip.speciesCount} species &middot; {trip.sightings.length} sightings
      </p>
      <p className="text-sm text-gray-500 mb-4">
        <Link href={`/user/${username}/trips`} className="hover:underline">
          &larr; {user.displayName}&apos;s trips
        </Link>
      </p>
      <div className="space-y-3">
        {sightingsWithPhotos.map((sighting) => (
          <SightingCard key={sighting.id} sighting={sighting} />
        ))}
      </div>
    </div>
  );
}
