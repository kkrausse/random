"use client";

import SightingForm from "@/components/SightingForm";
import Link from "next/link";

interface SightingData {
  id: number;
  species: string;
  speciesCode: string;
  date: string;
  lat: number;
  lng: number;
  locationName: string;
  notes: string | null;
  photos: { id: number; filename: string }[];
}

export default function EditForm({ sighting }: { sighting: SightingData }) {
  return (
    <main className="p-6">
      <div className="max-w-2xl mx-auto mb-4">
        <Link
          href={`/sighting/${sighting.id}`}
          className="text-blue-600 hover:underline text-sm"
        >
          &larr; Back
        </Link>
        <h1 className="text-2xl font-bold mt-2">Edit Sighting</h1>
      </div>
      <SightingForm sighting={sighting} />
    </main>
  );
}
