"use client";

import { useEffect, useState } from "react";
import MapView from "@/components/MapView";

interface Sighting {
  id: number;
  species: string;
  date: string;
  lat: number;
  lng: number;
  locationName: string;
}

export default function MapPage() {
  const [sightings, setSightings] = useState<Sighting[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/sightings")
      .then((r) => r.json())
      .then((data) => {
        setSightings(data);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="p-4 text-center text-gray-500">Loading map...</div>
    );
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Sighting Map</h1>
      {sightings.length === 0 ? (
        <p className="text-gray-500">No sightings yet. Add one to see it on the map!</p>
      ) : (
        <MapView sightings={sightings} />
      )}
    </div>
  );
}
