import { ReactNode } from "react";
import { db } from "@/db";
import { sightings, photos, users } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { connection } from "next/server";
import { shuffle } from "@/lib/shuffle";
import {
  DEFAULT_PHOTO_SORT,
  type PhotoSort,
} from "@/lib/photo-sort";
import PhotoGrid from "./PhotoGrid";
import PhotoSortSelect from "./PhotoSortSelect";

interface Props {
  userId?: string;
  emptyElement?: ReactNode;
  sort?: PhotoSort;
}

interface PhotoItem {
  sightingId: number;
  species: string;
  date: string;
  locationName: string;
  photoFilename: string;
  username: string;
  width?: number;
  height?: number;
  createdAt: string;
}

function sortPhotoItems(items: PhotoItem[], sort: PhotoSort) {
  if (sort === "shuffle") {
    return shuffle(items);
  }

  return [...items].sort((a, b) => {
    if (sort === "created-desc") {
      return (
        b.createdAt.localeCompare(a.createdAt) ||
        b.sightingId - a.sightingId ||
        b.photoFilename.localeCompare(a.photoFilename)
      );
    }

    if (sort === "species-az") {
      return (
        a.species.localeCompare(b.species) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.photoFilename.localeCompare(b.photoFilename)
      );
    }

    if (sort === "quality") {
      const aPixels = (a.width ?? 0) * (a.height ?? 0);
      const bPixels = (b.width ?? 0) * (b.height ?? 0);

      return (
        bPixels - aPixels ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.photoFilename.localeCompare(b.photoFilename)
      );
    }

    return (
      a.createdAt.localeCompare(b.createdAt) ||
      a.sightingId - b.sightingId ||
      a.photoFilename.localeCompare(b.photoFilename)
    );
  });
}

export default async function PhotoGridLoader({
  userId,
  emptyElement,
  sort = DEFAULT_PHOTO_SORT,
}: Props = {}) {
  // Opt this component out of static prerendering so it always
  // fetches fresh data at request time while the page shell stays static.
  await connection();

  const allSightings = await db
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
    .where(userId ? eq(sightings.userId, userId) : undefined)
    .orderBy(desc(sightings.date), desc(sightings.createdAt));

  const sightingIds = allSightings.map((s) => s.id);
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

  const photoItems = sortPhotoItems(allSightings.flatMap((s) => {
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
      createdAt: p.createdAt,
    }));
  }), sort);

  if (photoItems.length === 0) {
    return emptyElement ?? (
      <div className="text-center py-20 text-gray-500">
        <p className="text-lg mb-2">No photos yet.</p>
        <a href="/add" className="text-green-600 hover:underline">
          Log a sighting with a photo to fill up your gallery!
        </a>
      </div>
    );
  }

  return (
    <>
      <PhotoSortSelect value={sort} className="mb-2" />
      <PhotoGrid items={photoItems} />
    </>
  );
}
