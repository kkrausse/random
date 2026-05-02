export const dynamic = "force-dynamic";

import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import { db } from "@/db";
import { sightings, photos } from "@/db/schema";
import { eq } from "drizzle-orm";
import EditForm from "./EditForm";

export default async function EditSightingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { id } = await params;
  const sighting = await db
    .select()
    .from(sightings)
    .where(eq(sightings.id, parseInt(id)))
    .get();

  if (!sighting) notFound();
  if (sighting.userId !== userId) notFound();

  const sightingPhotos = await db
    .select()
    .from(photos)
    .where(eq(photos.sightingId, sighting.id));

  return (
    <EditForm
      sighting={{
        id: sighting.id,
        species: sighting.species,
        speciesCode: sighting.speciesCode,
        date: sighting.date,
        lat: sighting.lat,
        lng: sighting.lng,
        locationName: sighting.locationName,
        notes: sighting.notes ?? null,
        photos: sightingPhotos,
      }}
    />
  );
}
