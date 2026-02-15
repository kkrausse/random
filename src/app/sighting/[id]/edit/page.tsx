"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
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

export default function EditSightingPage() {
  const params = useParams();
  const [sighting, setSighting] = useState<SightingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/sightings/${params.id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Sighting not found");
        return res.json();
      })
      .then(setSighting)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) {
    return <div className="p-6 text-center text-gray-500">Loading...</div>;
  }

  if (error || !sighting) {
    return (
      <div className="p-6 text-center">
        <p className="text-red-600 mb-4">{error || "Sighting not found"}</p>
        <Link href="/" className="text-blue-600 hover:underline">Back to sightings</Link>
      </div>
    );
  }

  return (
    <main className="p-6">
      <div className="max-w-2xl mx-auto mb-4">
        <Link href="/" className="text-blue-600 hover:underline text-sm">&larr; Back</Link>
        <h1 className="text-2xl font-bold mt-2">Edit Sighting</h1>
      </div>
      <SightingForm sighting={sighting} />
    </main>
  );
}
