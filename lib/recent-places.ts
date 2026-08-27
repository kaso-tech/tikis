import AsyncStorage from "@react-native-async-storage/async-storage";
import type { LocationLabel } from "@/shared/tikis-domain";
import { MAX_RECENT_PLACES, mergeRecentPlaces } from "@/lib/recent-places-rules";

const keyFor = (profilePhone: string) => `tikis:recent-places:${profilePhone}`;

function isPlace(value: unknown): value is LocationLabel {
  if (!value || typeof value !== "object") return false;
  const place = value as Partial<LocationLabel>;
  return typeof place.name === "string" && typeof place.district === "string" && typeof place.city === "string" && Number.isFinite(place.latitude) && Number.isFinite(place.longitude) && Number(place.latitude) >= -90 && Number(place.latitude) <= 90 && Number(place.longitude) >= -180 && Number(place.longitude) <= 180;
}

export { mergeRecentPlaces } from "@/lib/recent-places-rules";

export async function loadRecentPlaces(profilePhone: string) {
  try {
    const raw = await AsyncStorage.getItem(keyFor(profilePhone));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isPlace).slice(0, MAX_RECENT_PLACES) : [];
  } catch { return []; }
}

export async function rememberRecentPlace(profilePhone: string, place: LocationLabel) {
  const current = await loadRecentPlaces(profilePhone);
  const next = mergeRecentPlaces(current, place);
  await AsyncStorage.setItem(keyFor(profilePhone), JSON.stringify(next));
  return next;
}
