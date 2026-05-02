import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { sightings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getUserByUsername } from "@/lib/users";
import { computeTrips } from "@/lib/trips";
import TripCard from "@/components/TripCard";
import TripsMap from "@/components/TripsMap";

export default function UserTripsPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  return (
    <Suspense fallback={<div className="p-4 text-center text-gray-500">Loading trips...</div>}>
      <UserTripsContent params={params} />
    </Suspense>
  );
}

async function UserTripsContent({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  await connection();
  const { username } = await params;

  const user = await getUserByUsername(username);
  if (!user) notFound();

  const userSightings = await db
    .select()
    .from(sightings)
    .where(eq(sightings.userId, user.id));

  const trips = computeTrips(userSightings);

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">{user.displayName}&apos;s Trips</h1>
      {trips.length === 0 ? (
        <p className="text-gray-500">No trips yet.</p>
      ) : (
        <>
          <TripsMap trips={trips} basePath={`/user/${username}/trips`} />
          <div className="space-y-3 mt-6">
            {trips.map((trip) => (
              <TripCard key={trip.id} trip={trip} basePath={`/user/${username}/trips`} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
