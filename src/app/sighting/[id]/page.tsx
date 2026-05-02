import { db } from "@/db";
import { sightings, photos } from "@/db/schema";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import DeleteButton from "@/components/DeleteButton";

export const dynamic = "force-dynamic";

export default async function SightingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { userId } = await auth();
  const { id } = await params;
  const sightingId = Number(id);
  if (isNaN(sightingId)) notFound();

  const [sighting] = await db
    .select()
    .from(sightings)
    .where(eq(sightings.id, sightingId));

  if (!sighting) notFound();

  const sightingPhotos = await db
    .select()
    .from(photos)
    .where(eq(photos.sightingId, sightingId));

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <Link href="/" className="text-blue-600 hover:underline text-sm">
        &larr; Back
      </Link>

      <h1 className="text-2xl font-bold mt-3 mb-1">{sighting.species}</h1>
      <p className="text-sm text-gray-500 mb-1">{sighting.date}</p>
      <p className="text-sm text-gray-600 mb-1">{sighting.locationName}</p>
      <p className="text-xs text-gray-400 mb-4">
        {sighting.lat.toFixed(5)}, {sighting.lng.toFixed(5)}
      </p>

      {sighting.notes && (
        <p className="text-gray-700 mb-6">{sighting.notes}</p>
      )}

      {sightingPhotos.length > 0 && (
        <div className="space-y-4 mb-6">
          {sightingPhotos.map((photo) => (
            <img
              key={photo.id}
              src={`/api/uploads/${photo.filename}`}
              alt={sighting.species}
              className="w-full rounded-lg"
            />
          ))}
        </div>
      )}

      {userId === sighting.userId && (
        <div className="flex gap-3">
          <Link
            href={`/sighting/${sighting.id}/edit`}
            className="text-blue-600 hover:underline text-sm"
          >
            Edit
          </Link>
          <DeleteButton sightingId={sighting.id} />
        </div>
      )}
    </main>
  );
}
