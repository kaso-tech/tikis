import type { LocationLabel } from "@/shared/tikis-domain";

export const MAX_RECENT_PLACES = 3;
const idFor = (place: LocationLabel) => `${place.latitude.toFixed(5)}:${place.longitude.toFixed(5)}`;

export function mergeRecentPlaces(existing: LocationLabel[], place: LocationLabel) {
  return [place, ...existing.filter((item) => idFor(item) !== idFor(place))].slice(0, MAX_RECENT_PLACES);
}
