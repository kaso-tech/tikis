import { randomUUID } from "node:crypto";

import { normalizeLocation, sanitizePlaceText } from "../lib/geo-rules";
import { COUNTRIES } from "../lib/registration-rules";
import type { LocationLabel, PlaceSuggestion } from "../shared/tikis-domain";
import * as db from "./db";
import { recordGeographicMetric } from "./geography-observability";

type MapboxSuggestion = {
  mapbox_id?: string;
  name?: string;
  name_preferred?: string;
  address?: string;
  full_address?: string;
  place_formatted?: string;
  feature_type?: string;
  context?: Record<string, unknown>;
};

type MapboxFeature = {
  id?: string;
  properties?: Record<string, unknown>;
  geometry?: { coordinates?: unknown };
};

type OpenStreetMapPlace = {
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  category?: string;
  address?: Record<string, unknown>;
};

type CacheEntry<T> = { value: T; expiresAt: number };
const searchCache = new Map<string, CacheEntry<PlaceSuggestion[]>>();
const routeCache = new Map<string, CacheEntry<{ distanceKm: number; durationMinutes: number; coordinates: { latitude: number; longitude: number }[] }>>();
const SEARCH_CACHE_TTL_MS = 20_000;
const ROUTE_CACHE_TTL_MS = 5 * 60_000;
const CACHE_LIMIT = 200;
const MAPBOX_TIMEOUT_MS = 8_000;
const OSM_TIMEOUT_MS = 6_000;
const OSM_MINIMUM_INTERVAL_MS = 1_000;
const OSM_SEARCH_URL = process.env.TIKIS_OSM_SEARCH_URL || "https://nominatim.openstreetmap.org/search";
let nextOpenStreetMapRequestAt = 0;

function readCache<T>(cache: Map<string, CacheEntry<T>>, key: string) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number) {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function resetGeographicCachesForTests() {
  searchCache.clear();
  routeCache.clear();
  nextOpenStreetMapRequestAt = 0;
}

function searchCacheKey(query: string, bias?: { latitude: number; longitude: number }, countryCode?: string, includeCommunityFallback = false) {
  const biasKey = bias ? `${bias.latitude.toFixed(3)}:${bias.longitude.toFixed(3)}` : "none";
  return `${query.toLocaleLowerCase("fr")}::${countryCode ?? "all"}::${biasKey}::${includeCommunityFallback ? "expanded" : "mapbox"}`;
}

function routeCacheKey(origin: LocationLabel, destination: LocationLabel) {
  return `${db.coordinateCacheKey(origin.latitude, origin.longitude)}>${db.coordinateCacheKey(destination.latitude, destination.longitude)}`;
}

function placePersistenceInput(place: LocationLabel) {
  return {
    googlePlaceId: place.googlePlaceId,
    mapboxPlaceId: place.mapboxId,
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    formattedAddress: place.formattedAddress ?? place.name,
    placeName: place.name,
    street: place.street,
    district: place.district,
    city: place.city,
    province: place.province,
    country: place.country,
    provider: place.provider ?? (place.mapboxId ? "mapbox" : "manual"),
    source: place.source ?? (place.mapboxId ? "retrieve" : "manual"),
    featureType: place.featureType ?? "unknown",
    precision: place.precision ?? "unknown",
  };
}

async function rememberResolvedPlace(place: LocationLabel) {
  try {
    const persisted = await db.saveTikisPlace(placePersistenceInput(place));
    return db.tikisPlaceToLocation(persisted);
  } catch {
    // Le cache améliore les performances mais ne doit jamais empêcher une sélection géographique valide.
    return place;
  }
}

function ensureCountry(place: LocationLabel, countryCode?: string) {
  if (!countryCode || !place.country) return place;
  const expectedCountry = COUNTRIES.find((country) => country.id === countryCode)?.name;
  if (expectedCountry && place.country.localeCompare(expectedCountry, "fr", { sensitivity: "base" }) !== 0) {
    throw new Error("Ce lieu se trouve hors du pays associé à votre profil.");
  }
  return place;
}

function backendToken() {
  const token = process.env.MAPBOX_SECRET_ACCESS_TOKEN;
  if (!token) throw new Error("Le service géographique sécurisé est indisponible : jeton Mapbox backend manquant.");
  return token;
}

function stringField(input: Record<string, unknown> | undefined, key: string) {
  const value = input?.[key];
  return typeof value === "string" ? value : "";
}

function contextField(input: Record<string, unknown> | undefined, key: string) {
  const value = input?.[key];
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return typeof record.name === "string" ? record.name : typeof record.text === "string" ? record.text : "";
}

function featurePrecision(feature: MapboxFeature) {
  const type = stringField(feature.properties, "feature_type");
  return type === "address" || type === "secondary_address" ? 0 : type === "street" ? 1 : type === "neighborhood" ? 2 : type === "locality" ? 3 : type === "place" ? 4 : 5;
}

function mapboxFeatureType(value: string): NonNullable<LocationLabel["featureType"]> {
  return ["address", "secondary_address", "poi", "street", "neighborhood", "locality", "place"].includes(value) ? value as NonNullable<LocationLabel["featureType"]> : "unknown";
}

function mapboxPrecision(value: NonNullable<LocationLabel["featureType"]>): NonNullable<LocationLabel["precision"]> {
  if (value === "address" || value === "secondary_address" || value === "poi") return "exact";
  if (value === "street") return "street";
  if (value === "neighborhood" || value === "locality") return "area";
  if (value === "place") return "city";
  return "unknown";
}

export function pinReverseLocationToCoordinate(place: LocationLabel, latitude: number, longitude: number): LocationLabel {
  return { ...place, latitude, longitude, source: "reverse", precision: "exact" };
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

function suggestionToPlaceSuggestion(suggestion: MapboxSuggestion, sessionToken: string): PlaceSuggestion | null {
  const mapboxId = suggestion.mapbox_id;
  const name = suggestion.name_preferred || suggestion.name;
  if (!mapboxId || !name || suggestion.feature_type === "category") return null;
  const context = suggestion.context;
  const street = suggestion.address || contextField(context, "street");
  const district = contextField(context, "neighborhood") || contextField(context, "district") || contextField(context, "locality");
  const city = contextField(context, "place") || contextField(context, "locality") || suggestion.place_formatted || "";
  return {
    id: `mapbox:${mapboxId}`,
    name,
    district,
    city,
    street,
    province: contextField(context, "region"),
    country: contextField(context, "country"),
    formattedAddress: suggestion.full_address || [street, district, city].filter(Boolean).join(", ") || name,
    mapboxId,
    mapboxSessionToken: sessionToken,
    featureType: mapboxFeatureType(suggestion.feature_type ?? ""),
  };
}

function locationToDirectSuggestion(place: LocationLabel): PlaceSuggestion {
  return {
    id: `${place.provider ?? "manual"}:${place.mapboxId ?? `${place.latitude.toFixed(5)}:${place.longitude.toFixed(5)}`}`,
    ...(place.mapboxId ? { mapboxId: place.mapboxId } : {}),
    name: place.name,
    district: place.district,
    city: place.city,
    ...(place.formattedAddress ? { formattedAddress: place.formattedAddress } : {}),
    ...(place.street ? { street: place.street } : {}),
    ...(place.province ? { province: place.province } : {}),
    ...(place.country ? { country: place.country } : {}),
    ...(place.featureType ? { featureType: place.featureType } : {}),
    ...(place.provider ? { provider: place.provider } : {}),
    directLocation: place,
  };
}

function mergeSuggestions(...groups: PlaceSuggestion[][]) {
  const unique = new Map<string, PlaceSuggestion>();
  for (const group of groups) for (const suggestion of group) if (!unique.has(suggestion.id)) unique.set(suggestion.id, suggestion);
  return [...unique.values()].slice(0, 12);
}

function openStreetMapLocation(item: OpenStreetMapPlace): LocationLabel | null {
  const latitude = Number(item.lat);
  const longitude = Number(item.lon);
  const address = item.address ?? {};
  const street = [contextField(address, "house_number"), contextField(address, "road")].filter(Boolean).join(" ");
  const district = contextField(address, "neighbourhood") || contextField(address, "suburb") || contextField(address, "city_district");
  const city = contextField(address, "city") || contextField(address, "town") || contextField(address, "village") || contextField(address, "municipality") || contextField(address, "county");
  const name = item.name || street || district || city;
  return normalizeLocation({ name, street, district, city, province: contextField(address, "state"), country: contextField(address, "country"), formattedAddress: item.display_name, latitude, longitude, provider: "openstreetmap", source: "search", featureType: item.category === "place" ? "place" : "poi", precision: street || item.category === "amenity" || item.category === "shop" ? "exact" : district ? "area" : city ? "city" : "unknown" });
}

async function searchOpenStreetMapPlaces(query: string, countryCode?: string) {
  const now = Date.now();
  if (now < nextOpenStreetMapRequestAt) return [];
  nextOpenStreetMapRequestAt = now + OSM_MINIMUM_INTERVAL_MS;
  const url = new URL(OSM_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "5");
  if (countryCode) url.searchParams.set("countrycodes", countryCode.toLowerCase());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OSM_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { "User-Agent": "Tikis development place search/1.0", "Accept-Language": "fr" }, signal: controller.signal });
    if (!response.ok) return [];
    const payload = await response.json() as unknown;
    return Array.isArray(payload) ? payload.map((item) => openStreetMapLocation(item as OpenStreetMapPlace)).filter((item): item is LocationLabel => Boolean(item)) : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function reverseOpenStreetMapLocation(latitude: number, longitude: number, countryCode?: string) {
  const now = Date.now();
  if (now < nextOpenStreetMapRequestAt) return null;
  nextOpenStreetMapRequestAt = now + OSM_MINIMUM_INTERVAL_MS;
  const url = new URL(OSM_SEARCH_URL.replace(/\/search\/?$/, "/reverse"));
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("zoom", "18");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OSM_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { "User-Agent": "Tikis development place search/1.0", "Accept-Language": "fr" }, signal: controller.signal });
    if (!response.ok) return null;
    const item = await response.json() as OpenStreetMapPlace;
    const place = openStreetMapLocation({ ...item, lat: String(latitude), lon: String(longitude) });
    return place ? ensureCountry(place, countryCode) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function searchMapboxForward(query: string, bias?: { latitude: number; longitude: number }, countryCode?: string) {
  const url = new URL("https://api.mapbox.com/search/searchbox/v1/forward");
  url.searchParams.set("q", query);
  url.searchParams.set("language", "fr");
  url.searchParams.set("limit", "10");
  url.searchParams.set("types", "poi,address,street,neighborhood,locality,place");
  url.searchParams.set("auto_complete", "true");
  if (countryCode) url.searchParams.set("country", countryCode);
  if (bias) url.searchParams.set("proximity", `${bias.longitude},${bias.latitude}`);
  const payload = await mapboxJson(url, "Search") as { features?: MapboxFeature[] };
  return (payload.features ?? []).map((feature) => featureToLocation(feature, "forward")).filter((item): item is LocationLabel => Boolean(item));
}

function featureToLocation(feature: MapboxFeature, source: NonNullable<LocationLabel["source"]>): LocationLabel | null {
  const coordinates = coordinatePair(feature);
  if (!coordinates) return null;
  const properties = feature.properties;
  const context = (properties?.context ?? {}) as Record<string, unknown>;
  const type = mapboxFeatureType(stringField(properties, "feature_type"));
  const street = stringField(properties, "address") || contextField(context, "street");
  const district = contextField(context, "neighborhood") || contextField(context, "district") || contextField(context, "locality");
  const city = contextField(context, "place") || contextField(context, "locality") || contextField(context, "region");
  const rawName = stringField(properties, "name_preferred") || stringField(properties, "name");
  const fullAddress = stringField(properties, "full_address") || stringField(properties, "place_formatted");
  const name = rawName || street || district || fullAddress || (city ? "Point sélectionné" : "");
  if (!name) return null;
  const preciseName = (type === "place" || type === "locality") && !street && !district ? "Point sélectionné" : name;
  return normalizeLocation({
    name: preciseName,
    district,
    city,
    street,
    province: contextField(context, "region"),
    country: contextField(context, "country"),
    formattedAddress: fullAddress || [street, district, city].filter(Boolean).join(", ") || preciseName,
    mapboxId: stringField(properties, "mapbox_id") || feature.id,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    provider: "mapbox",
    source,
    featureType: type,
    precision: mapboxPrecision(type),
  });
}

async function mapboxJson(url: URL, service: "Search" | "Directions") {
  url.searchParams.set("access_token", backendToken());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAPBOX_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(mapboxError(response, service));
    return response.json() as Promise<unknown>;
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw new Error("Le service géographique prend trop de temps. Réessayez dans quelques instants.");
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchPlaces(query: string, bias?: { latitude: number; longitude: number }, countryCode?: string, includeCommunityFallback = false) {
  const textQuery = sanitizePlaceText(query, 120);
  if (textQuery.length < 2) return [];
  const safeCountryCode = countryCode && /^[A-Z]{2}$/.test(countryCode) ? countryCode : undefined;
  const cacheKey = searchCacheKey(textQuery, bias, safeCountryCode, includeCommunityFallback);
  const cached = readCache(searchCache, cacheKey);
  if (cached) { recordGeographicMetric("search", "cache_hit"); return cached; }
  const startedAt = Date.now();
  const sessionToken = randomUUID();
  const url = new URL("https://api.mapbox.com/search/searchbox/v1/suggest");
  url.searchParams.set("q", textQuery);
  url.searchParams.set("language", "fr");
  url.searchParams.set("limit", "10");
  url.searchParams.set("types", "address,poi,street,neighborhood,locality,place");
  url.searchParams.set("session_token", sessionToken);
  if (safeCountryCode) url.searchParams.set("country", safeCountryCode);
  if (bias) url.searchParams.set("proximity", `${bias.longitude},${bias.latitude}`);
  try {
    const payload = await mapboxJson(url, "Search") as { suggestions?: MapboxSuggestion[] };
    let suggestions = (payload.suggestions ?? []).map((item) => suggestionToPlaceSuggestion(item, sessionToken)).filter((item): item is PlaceSuggestion => Boolean(item));
    if (includeCommunityFallback) {
      const directMapbox = await searchMapboxForward(textQuery, bias, safeCountryCode);
      suggestions = mergeSuggestions(suggestions, directMapbox.map(locationToDirectSuggestion));
      if (suggestions.length < 12) suggestions = mergeSuggestions(suggestions, (await searchOpenStreetMapPlaces(textQuery, safeCountryCode)).map(locationToDirectSuggestion));
    }
    writeCache(searchCache, cacheKey, suggestions, SEARCH_CACHE_TTL_MS);
    recordGeographicMetric("search", "success", Date.now() - startedAt);
    return suggestions;
  } catch (cause) { recordGeographicMetric("search", "failure", Date.now() - startedAt); throw cause; }
}

export async function resolveMapboxPlace(mapboxId: string, sessionToken?: string, countryCode?: string) {
  const safeId = mapboxId.trim();
  if (!safeId || safeId.length > 255) throw new Error("Identifiant Mapbox invalide.");
  const cached = await db.getTikisPlaceByMapboxId(safeId);
  if (cached) { recordGeographicMetric("resolve", "cache_hit"); return ensureCountry(db.tikisPlaceToLocation(cached), countryCode); }
  const startedAt = Date.now();
  const url = new URL(`https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(safeId)}`);
  url.searchParams.set("session_token", sessionToken?.trim() || randomUUID());
  try {
    const payload = await mapboxJson(url, "Search") as { features?: MapboxFeature[] };
    const place = payload.features?.map((feature) => featureToLocation(feature, "retrieve")).find((item): item is LocationLabel => Boolean(item));
    if (!place) throw new Error("Mapbox n’a pas renvoyé de coordonnées exploitables pour ce lieu.");
    const resolved = await rememberResolvedPlace(ensureCountry(place, countryCode));
    recordGeographicMetric("resolve", "success", Date.now() - startedAt);
    return resolved;
  } catch (cause) { recordGeographicMetric("resolve", "failure", Date.now() - startedAt); throw cause; }
}

export async function reverseGeocodeLocation(latitude: number, longitude: number, countryCode?: string) {
  const cached = await db.getTikisPlaceByCoordinate(latitude, longitude);
  if (cached) { recordGeographicMetric("reverse", "cache_hit"); return ensureCountry(db.tikisPlaceToLocation(cached), countryCode); }
  const startedAt = Date.now();
  let mapboxPlace: LocationLabel | null = null;
  let mapboxErrorCause: unknown = null;
  const url = new URL("https://api.mapbox.com/search/geocode/v6/reverse");
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("language", "fr");
  url.searchParams.set("types", "address,street,neighborhood,locality,place");
  try {
    const payload = await mapboxJson(url, "Search") as { features?: MapboxFeature[] };
    const resolved = (payload.features ?? []).sort((left, right) => featurePrecision(left) - featurePrecision(right)).map((feature) => featureToLocation(feature, "reverse")).find((item): item is LocationLabel => Boolean(item)) ?? null;
    mapboxPlace = resolved ? pinReverseLocationToCoordinate(resolved, latitude, longitude) : null;
    if (mapboxPlace) mapboxPlace = ensureCountry(mapboxPlace, countryCode);
  } catch (cause) {
    mapboxErrorCause = cause;
  }
  const needsCommunityFallback = !mapboxPlace || mapboxPlace.precision === "city" || mapboxPlace.precision === "unknown" || mapboxPlace.featureType === "place" || mapboxPlace.featureType === "locality";
  if (needsCommunityFallback) {
    const communityPlace = await reverseOpenStreetMapLocation(latitude, longitude, countryCode);
    if (communityPlace && (communityPlace.precision === "exact" || communityPlace.precision === "street" || !mapboxPlace)) {
      const resolved = await rememberResolvedPlace(pinReverseLocationToCoordinate(communityPlace, latitude, longitude));
      recordGeographicMetric("reverse", "success", Date.now() - startedAt);
      return resolved;
    }
  }
  if (mapboxPlace) {
    const resolved = await rememberResolvedPlace(mapboxPlace);
    recordGeographicMetric("reverse", "success", Date.now() - startedAt);
    return resolved;
  }
  recordGeographicMetric("reverse", "failure", Date.now() - startedAt);
  if (mapboxErrorCause) throw mapboxErrorCause;
  return null;
}

export async function geocodeAddress(address: string, countryCode?: string) {
  const query = sanitizePlaceText(address, 180);
  if (query.length < 3) return null;
  const startedAt = Date.now();
  const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  url.searchParams.set("q", query);
  url.searchParams.set("language", "fr");
  url.searchParams.set("limit", "1");
  if (countryCode && /^[A-Z]{2}$/.test(countryCode)) url.searchParams.set("country", countryCode);
  try {
    const payload = await mapboxJson(url, "Search") as { features?: MapboxFeature[] };
    const place = payload.features?.map((feature) => featureToLocation(feature, "forward")).find((item): item is LocationLabel => Boolean(item));
    const resolved = place ? await rememberResolvedPlace(ensureCountry(place, countryCode)) : null;
    recordGeographicMetric("forward", "success", Date.now() - startedAt);
    return resolved;
  } catch (cause) { recordGeographicMetric("forward", "failure", Date.now() - startedAt); throw cause; }
}

export async function computeRoute(origin: LocationLabel, destination: LocationLabel) {
  const cacheKey = routeCacheKey(origin, destination);
  const cached = readCache(routeCache, cacheKey);
  if (cached) { recordGeographicMetric("route", "cache_hit"); return cached; }
  const startedAt = Date.now();
  const coordinates = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
  const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coordinates}`);
  url.searchParams.set("alternatives", "false");
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("language", "fr");
  try {
    const payload = await mapboxJson(url, "Directions") as { routes?: Array<{ distance?: number; duration?: number; geometry?: { coordinates?: unknown } }> };
    const route = payload.routes?.[0];
    if (!route?.distance) throw new Error("Aucun itinéraire routier n’a été trouvé.");
    const coordinates = Array.isArray(route.geometry?.coordinates)
      ? route.geometry.coordinates.flatMap((value) => Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1])) ? [{ latitude: Number(value[1]), longitude: Number(value[0]) }] : [])
      : [];
    const result = { distanceKm: route.distance / 1000, durationMinutes: Math.max(1, Math.round((route.duration ?? 0) / 60)), coordinates };
    writeCache(routeCache, cacheKey, result, ROUTE_CACHE_TTL_MS);
    recordGeographicMetric("route", "success", Date.now() - startedAt);
    return result;
  } catch (cause) { recordGeographicMetric("route", "failure", Date.now() - startedAt); throw cause; }
}
