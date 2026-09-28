export type DistanceUnit = "mi" | "km";

export const KM_PER_MILE = 1.609344;

export const toKilometers = (distance: number, unit: DistanceUnit) => unit === "mi" ? distance * KM_PER_MILE : distance;
export const fromKilometers = (distance: number, unit: DistanceUnit) => unit === "mi" ? distance / KM_PER_MILE : distance;
export const displayDistance = (distanceKm: number, unit: DistanceUnit) => fromKilometers(distanceKm, unit).toFixed(1);
export const inputDistance = (distanceKm: number, unit: DistanceUnit) => Number(displayDistance(distanceKm, unit));
