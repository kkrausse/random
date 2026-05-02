"use client";

import { useEffect, useState } from "react";
import TripCard from "@/components/TripCard";
import TripsMap from "@/components/TripsMap";

interface Trip {
  id: string;
  startDate: string;
  endDate: string;
  locationName: string;
  speciesCount: number;
  lat: number;
  lng: number;
  sightings: { id: number; species: string }[];
}

export default function TripsPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/trips")
      .then((r) => r.json())
      .then((data) => {
        setTrips(data);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div className="p-4 text-center text-gray-500">Loading trips...</div>;
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Trips</h1>
      {trips.length === 0 ? (
        <p className="text-gray-500">No trips yet.</p>
      ) : (
        <>
          <TripsMap trips={trips} />
          <div className="space-y-3 mt-6">
            {trips.map((trip) => (
              <TripCard key={trip.id} trip={trip} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
