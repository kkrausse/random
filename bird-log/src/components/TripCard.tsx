import type { Route } from "next";
import Link from "next/link";

interface Trip {
  id: string;
  startDate: string;
  endDate: string;
  locationName: string;
  speciesCount: number;
  username?: string;
  displayName?: string;
  sightings: { id: number; species: string }[];
}

export default function TripCard({
  trip,
  href,
  showOwner = false,
}: {
  trip: Trip;
  href: Route<`/user/${string}/trips/${string}`>;
  showOwner?: boolean;
}) {
  const dateLabel =
    trip.startDate === trip.endDate
      ? trip.startDate
      : `${trip.startDate} to ${trip.endDate}`;

  return (
    <Link href={href}>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow">
        <h3 className="font-semibold text-lg">{trip.locationName}</h3>
        {showOwner && trip.username && (
          <p className="text-sm text-gray-500" title={trip.displayName}>
            @{trip.username}
          </p>
        )}
        <p className="text-sm text-gray-500">{dateLabel}</p>
        <p className="text-sm text-gray-600 mt-1">
          {trip.speciesCount} species &middot; {trip.sightings.length} sightings
        </p>
      </div>
    </Link>
  );
}
