"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";

interface Photo {
  id: number;
  filename: string;
}

interface Sighting {
  id: number;
  species: string;
  speciesCode: string;
  date: string;
  lat: number;
  lng: number;
  locationName: string;
  notes: string | null;
  photos: Photo[];
}

export default function SightingCard({ sighting }: { sighting: Sighting }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm("Delete this sighting?")) return;
    setDeleting(true);
    await fetch(`/api/sightings/${sighting.id}`, { method: "DELETE" });
    router.refresh();
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="flex justify-between items-start">
        <div>
          <h3 className="font-semibold text-lg">{sighting.species}</h3>
          <p className="text-sm text-gray-500">{sighting.date}</p>
          <p className="text-sm text-gray-600">{sighting.locationName}</p>
          {sighting.notes && (
            <p className="text-sm text-gray-700 mt-1">{sighting.notes}</p>
          )}
        </div>
        <div className="flex gap-2 items-center">
          <Link
            href={`/sighting/${sighting.id}/edit`}
            className="text-blue-400 hover:text-blue-600 text-sm"
          >
            Edit
          </Link>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-red-400 hover:text-red-600 text-sm"
          >
            {deleting ? "..." : "Delete"}
          </button>
        </div>
      </div>
      {sighting.photos.length > 0 && (
        <div className="flex gap-2 mt-3 overflow-x-auto">
          {sighting.photos.map((photo) => (
            <img
              key={photo.id}
              src={`/api/uploads/${photo.filename}`}
              alt={sighting.species}
              className="w-24 h-24 object-cover rounded-lg flex-shrink-0"
            />
          ))}
        </div>
      )}
    </div>
  );
}
