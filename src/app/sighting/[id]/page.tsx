import { Suspense } from "react";
import { connection } from "next/server";
import { db } from "@/db";
import { sightings, photos, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import DeleteButton from "@/components/DeleteButton";
import Loading from "./loading";

export default function SightingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<Loading />}>
      <SightingDetailContent params={params} />
    </Suspense>
  );
}

async function SightingDetailContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const { userId } = await auth();
  const { id } = await params;
  const sightingId = Number(id);
  if (isNaN(sightingId)) notFound();

  const [sightingRow] = await db
    .select({
      sighting: sightings,
      username: users.username,
      displayName: users.displayName,
    })
    .from(sightings)
    .innerJoin(users, eq(sightings.userId, users.id))
    .where(eq(sightings.id, sightingId));

  if (!sightingRow) notFound();

  const { sighting, username, displayName } = sightingRow;

  const sightingPhotos = await db
    .select()
    .from(photos)
    .where(eq(photos.sightingId, sightingId));

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <Link href="/" className="text-blue-600 hover:underline text-sm">
        &larr; Back to Explore
      </Link>

      <h1 className="text-2xl font-bold mt-3 mb-1">{sighting.species}</h1>
      <Link
        href={`/user/${username}`}
        className="text-sm text-blue-600 hover:underline"
      >
        by @{username}
        <span className="sr-only"> ({displayName})</span>
      </Link>
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
          <DeleteButton
            sightingId={sighting.id}
            redirectHref={`/user/${username}`}
          />
        </div>
      )}
    </main>
  );
}
