"use client";

import Link from "next/link";

interface PhotoItem {
  sightingId: number;
  species: string;
  date: string;
  locationName: string;
  photoFilename: string;
}

export default function PhotoGrid({ items }: { items: PhotoItem[] }) {
  return (
    <div className="flex flex-wrap justify-center gap-1 px-3">
      {items.map((item, i) => (
        <Link
          key={`${item.sightingId}-${item.photoFilename}-${i}`}
          href={`/sighting/${item.sightingId}`}
          className="relative group overflow-hidden rounded-sm"
        >
          <img
            src={`/api/uploads/${item.photoFilename}`}
            alt={item.species}
            className="block max-w-full"
          />
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
            <p className="text-white font-semibold text-sm">{item.species}</p>
            <p className="text-white/80 text-xs">{item.date}</p>
            <p className="text-white/80 text-xs">{item.locationName}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}
