"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import SightingCard from "@/components/SightingCard";

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

interface Trip {
  id: string;
  startDate: string;
  endDate: string;
  locationName: string;
  speciesCount: number;
  sightings: Sighting[];
}

export default function TripDetailPage() {
  const params = useParams();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [sightingsWithPhotos, setSightingsWithPhotos] = useState<Sighting[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/trips")
      .then((r) => r.json())
      .then((trips: Trip[]) => {
        const found = trips.find((t) => t.id === params.id);
        setTrip(found || null);
        if (found) {
          // Load full sighting data with photos
          Promise.all(
            found.sightings.map(async (s) => {
              const res = await fetch(`/api/sightings/${s.id}`);
              return res.json();
            })
          ).then(setSightingsWithPhotos);
        }
        setLoading(false);
      });
  }, [params.id]);

  if (loading) {
    return <div className="p-4 text-center text-gray-500">Loading...</div>;
  }

  if (!trip) {
    return <div className="p-4 text-center text-gray-500">Trip not found.</div>;
  }

  const dateLabel =
    trip.startDate === trip.endDate
      ? trip.startDate
      : `${trip.startDate} to ${trip.endDate}`;

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold">{trip.locationName}</h1>
      <p className="text-gray-500 mb-1">{dateLabel}</p>
      <p className="text-gray-600 mb-4">
        {trip.speciesCount} species &middot; {trip.sightings.length} sightings
      </p>
      <div className="space-y-3">
        {sightingsWithPhotos.map((sighting) => (
          <SightingCard key={sighting.id} sighting={sighting} />
        ))}
      </div>
    </div>
  );
}
