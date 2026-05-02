import { Suspense } from "react";
import { connection } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import { db } from "@/db";
import { sightings, photos } from "@/db/schema";
import { eq } from "drizzle-orm";
import EditForm from "./EditForm";
import Loading from "./loading";
import { signInRoute } from "@/lib/routes";

export default function EditSightingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<Loading />}>
      <EditSightingContent params={params} />
    </Suspense>
  );
}

async function EditSightingContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const { userId } = await auth();
  if (!userId) redirect(signInRoute);

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
