import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { sightings, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { computeTrips, type Sighting } from "@/lib/trips";

export default async function LegacyTripDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const { id } = await params;
  const tripId = decodeURIComponent(id);

  const rows = await db
    .select({
      sighting: sightings,
      username: users.username,
    })
    .from(sightings)
    .innerJoin(users, eq(sightings.userId, users.id));

  const sightingsByUser = new Map<string, { username: string; sightings: Sighting[] }>();
  for (const row of rows) {
    const entry = sightingsByUser.get(row.sighting.userId) ?? {
      username: row.username,
      sightings: [],
    };
    entry.sightings.push(row.sighting);
    sightingsByUser.set(row.sighting.userId, entry);
  }

  for (const { username, sightings: userSightings } of sightingsByUser.values()) {
    const trip = computeTrips(userSightings).find((trip) => trip.id === tripId);
    if (trip) {
      redirect(`/user/${username}/trips/${encodeURIComponent(trip.id)}`);
    }
  }

  notFound();
}
