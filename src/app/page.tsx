import { db } from "@/db";
import { sightings, photos } from "@/db/schema";
import { desc } from "drizzle-orm";
import Link from "next/link";
import PhotoGrid from "@/components/PhotoGrid";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const allSightings = await db
    .select()
    .from(sightings)
    .orderBy(desc(sightings.date), desc(sightings.createdAt));

  const allPhotos = await db.select().from(photos);
  const photoMap = new Map<number, typeof allPhotos>();
  for (const p of allPhotos) {
    const list = photoMap.get(p.sightingId) ?? [];
    list.push(p);
    photoMap.set(p.sightingId, list);
  }

  const photoItems = allSightings.flatMap((s) => {
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

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-green-800">Bird Log</h1>
        <Link
          href="/add"
          className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 font-medium"
        >
          + Add Sighting
        </Link>
      </div>

      {photoItems.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <p className="text-lg mb-2">No photos yet.</p>
          <Link href="/add" className="text-green-600 hover:underline">
            Log a sighting with a photo to fill up your gallery!
          </Link>
        </div>
      ) : (
        <PhotoGrid items={photoItems} />
      )}
    </div>
  );
}
