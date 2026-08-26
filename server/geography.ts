import { normalizeLocation, sanitizePlaceText } from "../lib/geo-rules";
import type { LocationLabel } from "../shared/tikis-domain";

type GoogleAddressComponent = { longText?: string; types?: string[] };
type GooglePlace = { id?: string; displayName?: { text?: string }; formattedAddress?: string; location?: { latitude?: number; longitude?: number }; addressComponents?: GoogleAddressComponent[] };

function backendKey() {
  const key = process.env.GOOGLE_MAPS_BACKEND_API_KEY;
  if (!key) throw new Error("Le service géographique sécurisé est indisponible : clé backend Google Maps manquante.");
  return key;
}

function component(components: GoogleAddressComponent[] | undefined, type: string) {
  return components?.find((item) => item.types?.includes(type))?.longText ?? "";
}

function toLocation(place: GooglePlace): LocationLabel | null {
  const address = place.formattedAddress ?? "";
  return normalizeLocation({
    name: place.displayName?.text ?? (component(place.addressComponents, "point_of_interest") || address),
    district: component(place.addressComponents, "sublocality") || component(place.addressComponents, "neighborhood"),
    city: component(place.addressComponents, "locality") || component(place.addressComponents, "administrative_area_level_2"),
    street: component(place.addressComponents, "route"),
    province: component(place.addressComponents, "administrative_area_level_1"),
    country: component(place.addressComponents, "country"),
    formattedAddress: address,
    googlePlaceId: place.id,
    latitude: place.location?.latitude,
    longitude: place.location?.longitude,
  });
}

const placeFields = "places.id,places.displayName,places.formattedAddress,places.location,places.addressComponents";

async function googleError(response: Response, service: "Places" | "Geocoding" | "Routes") {
  let detail = "";
  try {
    const payload = await response.json() as { error?: { message?: string } };
    detail = payload.error?.message ?? "";
  } catch {
    // No structured message was returned by Google.
  }
  if (response.status === 401 || response.status === 403) return `${service} API a refusé la clé backend. Vérifiez l’activation de l’API, la facturation et la restriction IP.${detail ? ` Détail Google : ${detail}` : ""}`;
  if (response.status === 429) return `${service} API est temporairement limitée. Réessayez dans quelques instants.`;
  return detail ? `${service} API est indisponible : ${detail}` : `${service} API est momentanément indisponible.`;
}

export async function searchPlaces(query: string, bias?: { latitude: number; longitude: number }) {
  const textQuery = sanitizePlaceText(query, 120);
  if (textQuery.length < 2) return [];
  const body: Record<string, unknown> = { textQuery, languageCode: "fr" };
  if (bias) body.locationBias = { circle: { center: { latitude: bias.latitude, longitude: bias.longitude }, radius: 25000 } };
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": backendKey(), "X-Goog-FieldMask": placeFields },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await googleError(response, "Places"));
  const payload = await response.json() as { places?: GooglePlace[] };
  return (payload.places ?? []).map(toLocation).filter((item): item is LocationLabel => Boolean(item)).slice(0, 8);
}

export async function reverseGeocodeLocation(latitude: number, longitude: number) {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("latlng", `${latitude},${longitude}`);
  url.searchParams.set("language", "fr");
  url.searchParams.set("key", backendKey());
  const response = await fetch(url);
  if (!response.ok) throw new Error(await googleError(response, "Geocoding"));
  const payload = await response.json() as { status?: string; error_message?: string; results?: Array<{ place_id?: string; formatted_address?: string; geometry?: { location?: { lat?: number; lng?: number } }; address_components?: Array<{ long_name?: string; types?: string[] }> }> };
  if (payload.status !== "OK") throw new Error(`Geocoding API n’a pas renvoyé de lieu.${payload.error_message ? ` Détail Google : ${payload.error_message}` : ""}`);
  const result = payload.results?.[0];
  if (!result?.geometry?.location) return null;
  return toLocation({ id: result.place_id, displayName: { text: result.formatted_address }, formattedAddress: result.formatted_address, location: { latitude: result.geometry.location.lat, longitude: result.geometry.location.lng }, addressComponents: result.address_components?.map((item) => ({ longText: item.long_name, types: item.types })) });
}

export async function geocodeAddress(address: string) {
  const query = sanitizePlaceText(address, 180);
  if (query.length < 3) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("language", "fr");
  url.searchParams.set("key", backendKey());
  const response = await fetch(url);
  if (!response.ok) throw new Error("Le géocodage est momentanément indisponible.");
  const payload = await response.json() as { results?: Array<{ place_id?: string; formatted_address?: string; geometry?: { location?: { lat?: number; lng?: number } }; address_components?: Array<{ long_name?: string; types?: string[] }> }> };
  const result = payload.results?.[0];
  if (!result?.geometry?.location) return null;
  return toLocation({ id: result.place_id, displayName: { text: result.formatted_address }, formattedAddress: result.formatted_address, location: { latitude: result.geometry.location.lat, longitude: result.geometry.location.lng }, addressComponents: result.address_components?.map((item) => ({ longText: item.long_name, types: item.types })) });
}

export async function computeRoute(origin: LocationLabel, destination: LocationLabel) {
  const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": backendKey(), "X-Goog-FieldMask": "routes.distanceMeters,routes.duration" },
    body: JSON.stringify({ origin: { location: { latLng: { latitude: origin.latitude, longitude: origin.longitude } } }, destination: { location: { latLng: { latitude: destination.latitude, longitude: destination.longitude } } }, travelMode: "DRIVE", languageCode: "fr" }),
  });
  if (!response.ok) throw new Error(await googleError(response, "Routes"));
  const payload = await response.json() as { routes?: Array<{ distanceMeters?: number; duration?: string }> };
  const route = payload.routes?.[0];
  if (!route?.distanceMeters) throw new Error("Aucun itinéraire routier n’a été trouvé.");
  return { distanceKm: route.distanceMeters / 1000, durationMinutes: Math.max(1, Math.round(Number.parseFloat(route.duration ?? "0") / 60)) };
}
