import { db } from "@/db";
import { sightings, photos } from "@/db/schema";
import { eq, desc, inArray } from "drizzle-orm";
import PhotoGrid from "@/components/PhotoGrid";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SpeciesPage({
  params,
}: {
  params: Promise<{ speciesCode: string }>;
}) {
  const { speciesCode } = await params;
  const speciesSightings = await db
    .select()
    .from(sightings)
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

  const photoItems = speciesSightings.flatMap((s) => {
    const sPhotos = photoMap.get(s.id) ?? [];
    return sPhotos.map((p) => ({
      sightingId: s.id,
      species: s.species,
      date: s.date,
      locationName: s.locationName,
      photoFilename: p.filename,
    }));
  });

  const speciesName = speciesSightings[0]?.species ?? speciesCode;

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

      {photoItems.length === 0 ? (
        <p className="text-gray-500 py-8 text-center">No photos for this species yet.</p>
      ) : (
        <PhotoGrid items={photoItems} singleColumn />
      )}
    </div>
  );
}
