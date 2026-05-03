import { Suspense } from "react";
import { auth } from "@clerk/nextjs/server";
import { connection } from "next/server";
import { db } from "@/db";
import { sightings, photos, users } from "@/db/schema";
import { eq, desc, inArray, and } from "drizzle-orm";
import PhotoGrid from "@/components/PhotoGrid";
import Link from "next/link";
import Loading from "./loading";
import { getUserById } from "@/lib/users";
import { shuffle } from "@/lib/shuffle";

export default function SpeciesPage({
  params,
}: {
  params: Promise<{ speciesCode: string }>;
}) {
  return (
    <Suspense fallback={<Loading />}>
      <SpeciesContent params={params} />
    </Suspense>
  );
}

async function SpeciesContent({
  params,
}: {
  params: Promise<{ speciesCode: string }>;
}) {
  await connection();
  const { speciesCode } = await params;
  const { userId } = await auth();

  const speciesSightings = await db
    .select({
      id: sightings.id,
      species: sightings.species,
      date: sightings.date,
      locationName: sightings.locationName,
      userId: sightings.userId,
      username: users.username,
    })
    .from(sightings)
    .innerJoin(users, eq(sightings.userId, users.id))
    .where(eq(sightings.speciesCode, speciesCode))
    .orderBy(desc(sightings.date), desc(sightings.createdAt));

  const sightingIds = speciesSightings.map((s) => s.id);
  const allPhotos =
    sightingIds.length > 0
      ? await db.select().from(photos).where(inArray(photos.sightingId, sightingIds))
      : [];

  const photoMap = new Map<number, typeof allPhotos>();
  for (const p of allPhotos) {
    const list = photoMap.get(p.sightingId) ?? [];
    list.push(p);
    photoMap.set(p.sightingId, list);
  }

  const photoItems = shuffle(speciesSightings.flatMap((s) => {
    const sPhotos = photoMap.get(s.id) ?? [];
    return sPhotos.map((p) => ({
      sightingId: s.id,
      species: s.species,
      date: s.date,
      locationName: s.locationName,
      photoFilename: p.filename,
      username: s.username,
      width: p.width ?? undefined,
      height: p.height ?? undefined,
    }));
  }));

  const speciesName = speciesSightings[0]?.species ?? speciesCode;
  const viewer = userId ? await getUserById(userId) : null;
  const viewerHasSeenSpecies = viewer
    ? (await db
        .select({ id: sightings.id })
        .from(sightings)
        .where(and(eq(sightings.userId, viewer.id), eq(sightings.speciesCode, speciesCode)))
        .limit(1)).length > 0
    : false;

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="mb-4">
        <Link href="/checklist" className="text-sm text-gray-500 hover:text-gray-700">
          ← Checklist
        </Link>
      </div>
      <h1 className="text-2xl font-bold mb-1">{speciesName}</h1>
      <p className="text-sm text-gray-500 mb-4">
        {speciesSightings.length} sighting{speciesSightings.length !== 1 ? "s" : ""}
        {photoItems.length > 0 ? `, ${photoItems.length} photo${photoItems.length !== 1 ? "s" : ""}` : ""}
      </p>
      {viewer && viewerHasSeenSpecies && (
        <Link
          href={`/user/${viewer.username}/species/${speciesCode}`}
          className="inline-block text-sm text-blue-600 hover:underline mb-4"
        >
          View my sightings
        </Link>
      )}

      {photoItems.length === 0 ? (
        <p className="text-gray-500 py-8 text-center">No photos for this species yet.</p>
      ) : (
        <PhotoGrid items={photoItems} singleColumn />
      )}
    </div>
  );
}
