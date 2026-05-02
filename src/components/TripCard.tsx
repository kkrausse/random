import Link from "next/link";

interface Trip {
  id: string;
  startDate: string;
  endDate: string;
  locationName: string;
  speciesCount: number;
  sightings: { id: number; species: string }[];
}

export default function TripCard({ trip, basePath = "/trips" }: { trip: Trip; basePath?: string }) {
  const dateLabel =
    trip.startDate === trip.endDate
      ? trip.startDate
      : `${trip.startDate} to ${trip.endDate}`;

  return (
    <Link href={`${basePath}/${encodeURIComponent(trip.id)}`}>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow">
        <h3 className="font-semibold text-lg">{trip.locationName}</h3>
        <p className="text-sm text-gray-500">{dateLabel}</p>
        <p className="text-sm text-gray-600 mt-1">
          {trip.speciesCount} species &middot; {trip.sightings.length} sightings
        </p>
      </div>
    </Link>
  );
}
