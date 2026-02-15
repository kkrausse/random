import { haversineDistance } from "./geo";

export interface Sighting {
  id: number;
  species: string;
  speciesCode: string;
  date: string;
  lat: number;
  lng: number;
  locationName: string;
  notes: string | null;
  createdAt: string;
}

export interface Trip {
  id: string; // date range or first date
  startDate: string;
  endDate: string;
  locationName: string;
  sightings: Sighting[];
  speciesCount: number;
  lat: number;
  lng: number;
}

const MAX_GAP_DAYS = 1;
const MAX_DISTANCE_MILES = 50;

function daysBetween(a: string, b: string): number {
  const da = new Date(a);
  const db = new Date(b);
  return Math.abs((db.getTime() - da.getTime()) / (1000 * 60 * 60 * 24));
}

function isNearGroup(
  sighting: Sighting,
  group: Sighting[]
): boolean {
  return group.some(
    (g) =>
      haversineDistance(sighting.lat, sighting.lng, g.lat, g.lng) <=
      MAX_DISTANCE_MILES
  );
}

export function computeTrips(sightings: Sighting[]): Trip[] {
  if (sightings.length === 0) return [];

  const sorted = [...sightings].sort(
    (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)
  );

  const groups: Sighting[][] = [[sorted[0]]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const lastGroup = groups[groups.length - 1];
    const lastDate = lastGroup[lastGroup.length - 1].date;

    if (
      daysBetween(lastDate, current.date) <= MAX_GAP_DAYS &&
      isNearGroup(current, lastGroup)
    ) {
      lastGroup.push(current);
    } else {
      groups.push([current]);
    }
  }

  return groups.map((group) => {
    const uniqueSpecies = new Set(group.map((s) => s.speciesCode));
    const startDate = group[0].date;
    const endDate = group[group.length - 1].date;
    return {
      id: `${startDate}_${group[0].lat}_${group[0].lng}`,
      startDate,
      endDate,
      locationName: group[0].locationName,
      sightings: group,
      speciesCount: uniqueSpecies.size,
      lat: group[0].lat,
      lng: group[0].lng,
    };
  });
}
