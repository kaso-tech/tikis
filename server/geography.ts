import { randomUUID } from "node:crypto";

import { normalizeLocation, sanitizePlaceText } from "../lib/geo-rules";
import type { LocationLabel } from "../shared/tikis-domain";

type MapboxSuggestion = {
  mapbox_id?: string;
  name?: string;
  name_preferred?: string;
  full_address?: string;
  place_formatted?: string;
};

type MapboxFeature = {
  id?: string;
  properties?: Record<string, unknown>;
  geometry?: { coordinates?: unknown };
};

function backendToken() {
  const token = process.env.MAPBOX_SECRET_ACCESS_TOKEN;
  if (!token) throw new Error("Le service géographique sécurisé est indisponible : jeton Mapbox backend manquant.");
  return token;
}

function stringField(input: Record<string, unknown> | undefined, key: string) {
  const value = input?.[key];
  return typeof value === "string" ? value : "";
}

function coordinatePair(feature: MapboxFeature) {
  const properties = feature.properties;
  const propertyCoordinates = properties?.coordinates as Record<string, unknown> | undefined;
  const longitude = typeof propertyCoordinates?.longitude === "number" ? propertyCoordinates.longitude : undefined;
  const latitude = typeof propertyCoordinates?.latitude === "number" ? propertyCoordinates.latitude : undefined;
  if (latitude !== undefined && longitude !== undefined) return { latitude, longitude };
  const geometryCoordinates = feature.geometry?.coordinates;
  if (Array.isArray(geometryCoordinates) && typeof geometryCoordinates[0] === "number" && typeof geometryCoordinates[1] === "number") {
    return { longitude: geometryCoordinates[0], latitude: geometryCoordinates[1] };
  }
  return null;
}

function mapboxError(response: Response, service: "Search" | "Directions") {
  const fallback = service === "Search" ? "La recherche Mapbox est momentanément indisponible." : "Le calcul d’itinéraire Mapbox est momentanément indisponible.";
  if (response.status === 401 || response.status === 403) return `${service} Mapbox a refusé le jeton backend. Vérifiez ses autorisations et restrictions.`;
  if (response.status === 429) return `${service} Mapbox est temporairement limité. Réessayez dans quelques instants.`;
  return fallback;
}

function suggestionToLocation(suggestion: MapboxSuggestion, sessionToken: string): LocationLabel | null {
  const mapboxId = suggestion.mapbox_id;
  const name = suggestion.name_preferred || suggestion.name;
  if (!mapboxId || !name) return null;
  return normalizeLocation({
    name,
    district: "",
    city: suggestion.place_formatted ?? "",
    formattedAddress: [suggestion.full_address, suggestion.place_formatted].filter(Boolean).join(", "),
    mapboxId,
    mapboxSessionToken: sessionToken,
    latitude: 0,
    longitude: 0,
  });
}

function featureToLocation(feature: MapboxFeature): LocationLabel | null {
  const coordinates = coordinatePair(feature);
  if (!coordinates) return null;
  const properties = feature.properties;
  const context = (properties?.context ?? {}) as Record<string, unknown>;
  const contextField = (key: string) => stringField(context, key);
  const name = stringField(properties, "name_preferred") || stringField(properties, "name") || stringField(properties, "full_address");
  if (!name) return null;
  return normalizeLocation({
    name,
    district: contextField("neighborhood") || contextField("locality") || contextField("district"),
    city: contextField("place") || contextField("locality") || contextField("region"),
    street: stringField(properties, "address") || contextField("street"),
    province: contextField("region"),
    country: contextField("country"),
    formattedAddress: stringField(properties, "full_address") || stringField(properties, "place_formatted") || name,
    mapboxId: stringField(properties, "mapbox_id") || feature.id,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
  });
}

async function mapboxJson(url: URL, service: "Search" | "Directions") {
  url.searchParams.set("access_token", backendToken());
  const response = await fetch(url);
  if (!response.ok) throw new Error(mapboxError(response, service));
  return response.json() as Promise<unknown>;
}

export async function searchPlaces(query: string, bias?: { latitude: number; longitude: number }) {
  const textQuery = sanitizePlaceText(query, 120);
  if (textQuery.length < 2) return [];
  const sessionToken = randomUUID();
  const url = new URL("https://api.mapbox.com/search/searchbox/v1/suggest");
  url.searchParams.set("q", textQuery);
  url.searchParams.set("language", "fr");
  url.searchParams.set("limit", "6");
  url.searchParams.set("session_token", sessionToken);
  if (bias) url.searchParams.set("proximity", `${bias.longitude},${bias.latitude}`);
  const payload = await mapboxJson(url, "Search") as { suggestions?: MapboxSuggestion[] };
  return (payload.suggestions ?? []).map((item) => suggestionToLocation(item, sessionToken)).filter((item): item is LocationLabel => Boolean(item));
}

export async function resolveMapboxPlace(mapboxId: string, sessionToken?: string) {
  const safeId = mapboxId.trim();
  if (!safeId || safeId.length > 255) throw new Error("Identifiant Mapbox invalide.");
  const url = new URL(`https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(safeId)}`);
  url.searchParams.set("session_token", sessionToken?.trim() || randomUUID());
  const payload = await mapboxJson(url, "Search") as { features?: MapboxFeature[] };
  const place = payload.features?.map(featureToLocation).find((item): item is LocationLabel => Boolean(item));
  if (!place) throw new Error("Mapbox n’a pas renvoyé de coordonnées exploitables pour ce lieu.");
  return place;
}

export async function reverseGeocodeLocation(latitude: number, longitude: number) {
  const url = new URL("https://api.mapbox.com/search/geocode/v6/reverse");
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("language", "fr");
  const payload = await mapboxJson(url, "Search") as { features?: MapboxFeature[] };
  return payload.features?.map(featureToLocation).find((item): item is LocationLabel => Boolean(item)) ?? null;
}

export async function geocodeAddress(address: string) {
  const query = sanitizePlaceText(address, 180);
  if (query.length < 3) return null;
  const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  url.searchParams.set("q", query);
  url.searchParams.set("language", "fr");
  url.searchParams.set("limit", "1");
  const payload = await mapboxJson(url, "Search") as { features?: MapboxFeature[] };
  return payload.features?.map(featureToLocation).find((item): item is LocationLabel => Boolean(item)) ?? null;
}

export async function computeRoute(origin: LocationLabel, destination: LocationLabel) {
  const coordinates = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
  const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coordinates}`);
  url.searchParams.set("alternatives", "false");
  url.searchParams.set("overview", "false");
  url.searchParams.set("language", "fr");
  const payload = await mapboxJson(url, "Directions") as { routes?: Array<{ distance?: number; duration?: number }> };
  const route = payload.routes?.[0];
  if (!route?.distance) throw new Error("Aucun itinéraire routier n’a été trouvé.");
  return { distanceKm: route.distance / 1000, durationMinutes: Math.max(1, Math.round((route.duration ?? 0) / 60)) };
}
