import type { Route } from "next";

export const signInRoute = "/sign-in/" satisfies Route<"/sign-in/">;

export function userRoute(username: string): Route<`/user/${string}`> {
  return `/user/${encodeURIComponent(username)}` as Route<`/user/${string}`>;
}

export function userChecklistRoute(username: string): Route<`/user/${string}/checklist`> {
  return `/user/${encodeURIComponent(username)}/checklist` as Route<`/user/${string}/checklist`>;
}

export function userTripsRoute(username: string): Route<`/user/${string}/trips`> {
  return `/user/${encodeURIComponent(username)}/trips` as Route<`/user/${string}/trips`>;
}

export function userTripRoute(
  username: string,
  tripId: string,
): Route<`/user/${string}/trips/${string}`> {
  return `/user/${encodeURIComponent(username)}/trips/${encodeURIComponent(tripId)}` as Route<
    `/user/${string}/trips/${string}`
  >;
}
