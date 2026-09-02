import type { DeliveryType, LocationLabel, LocationPresentation, SelectableVehicleType } from "@/shared/tikis-domain";

const safeWhitespace = /\s+/g;
const forbiddenPlaceChars = /[^\p{L}\p{N}\s,.'’\-()/]/gu;

export function sanitizePlaceText(value: string, maxLength = 120, options: { preserveTrailingSpace?: boolean } = {}) {
  const normalized = value.normalize("NFC").replace(forbiddenPlaceChars, "").replace(safeWhitespace, " ").trimStart().slice(0, maxLength);
  return options.preserveTrailingSpace ? normalized : normalized.trimEnd();
}

export function isValidCoordinate(latitude: number, longitude: number) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

export function normalizeLocation(input: Partial<LocationLabel>): LocationLabel | null {
  if (!isValidCoordinate(Number(input.latitude), Number(input.longitude))) return null;
  const name = sanitizePlaceText(input.name ?? "");
  const district = sanitizePlaceText(input.district ?? "");
  const city = sanitizePlaceText(input.city ?? "");
  const formattedAddress = sanitizePlaceText(input.formattedAddress ?? "", 255);
  if (![name, district, city, formattedAddress].some(Boolean)) return null;
  const googlePlaceId = sanitizePlaceText(input.googlePlaceId ?? "", 255);
  const mapboxId = sanitizePlaceText(input.mapboxId ?? "", 255);
  const mapboxSessionToken = (input.mapboxSessionToken ?? "").trim();
  const street = sanitizePlaceText(input.street ?? "");
  const province = sanitizePlaceText(input.province ?? "");
  const country = sanitizePlaceText(input.country ?? "");
  const provider = input.provider;
  const source = input.source;
  const featureType = input.featureType;
  const precision = input.precision;
  return {
    name: name || district || city || formattedAddress,
    district,
    city,
    latitude: Number(input.latitude),
    longitude: Number(input.longitude),
    ...(googlePlaceId ? { googlePlaceId } : {}),
    ...(mapboxId ? { mapboxId } : {}),
    ...(mapboxSessionToken ? { mapboxSessionToken } : {}),
    ...(formattedAddress ? { formattedAddress } : {}),
    ...(street ? { street } : {}),
    ...(province ? { province } : {}),
    ...(country ? { country } : {}),
    ...(provider ? { provider } : {}),
    ...(source ? { source } : {}),
    ...(featureType ? { featureType } : {}),
    ...(precision ? { precision } : {}),
  };
}

function distinctParts(parts: Array<string | undefined>) {
  return parts
    .map((part) => sanitizePlaceText(part ?? ""))
    .filter(Boolean)
    .filter((item, index, values) => values.findIndex((value) => value.localeCompare(item, "fr", { sensitivity: "base" }) === 0) === index);
}

function samePart(left: string | undefined, right: string | undefined) {
  return Boolean(left && right && left.localeCompare(right, "fr", { sensitivity: "base" }) === 0);
}

function isGenericName(location: LocationPresentation) {
  return !location.name || samePart(location.name, location.city) || location.name.localeCompare("Point sélectionné", "fr", { sensitivity: "base" }) === 0;
}

/**
 * Un nom de lieu ne prime sur le quartier que s'il s'agit d'un lieu public susceptible d'être
 * connu de tous (ex. « Maison du Peuple »), identifié ici par featureType "poi". Les anciens
 * enregistrements sans featureType conservent leur nom pour ne pas dégrader leur affichage.
 * Une adresse explicitement classée rue/adresse ne prime pas sur le quartier.
 */
function isPublicPlaceName(location: LocationPresentation) {
  return !isGenericName(location) && (location.featureType === "poi" || !location.featureType);
}

function localPart(location: LocationPresentation) {
  if (isPublicPlaceName(location)) return location.name;
  // Une rue constitue un repère plus précis qu’un quartier pour une adresse explicitement classée.
  return location.street || location.district || (!isGenericName(location) ? location.name : undefined) || location.city || location.province || location.formattedAddress || "Lieu sélectionné";
}

export function locationTitle(location: LocationPresentation) {
  if (isGenericName(location) && !location.street && !location.district && location.city) return "Point sélectionné";
  return localPart(location);
}

export function locationSubtitle(location: LocationPresentation) {
  return distinctParts([location.street, location.district, location.city, location.province, location.country])
    .filter((part) => !samePart(part, locationTitle(location)))
    .join(" · ") || location.formattedAddress || "Lieu à confirmer";
}

export function formatListRouteParts(pickup: LocationLabel, dropoff: LocationLabel) {
  const sameCity = Boolean(pickup.city && dropoff.city && pickup.city.localeCompare(dropoff.city, "fr", { sensitivity: "base" }) === 0);
  return sameCity
    ? { pickup: localPart(pickup), dropoff: localPart(dropoff), sameCity: true }
    : { pickup: pickup.city || pickup.province || localPart(pickup), dropoff: dropoff.city || dropoff.province || localPart(dropoff), sameCity: false };
}

export function formatListRoute(pickup: LocationLabel, dropoff: LocationLabel) {
  const route = formatListRouteParts(pickup, dropoff);
  return `${route.pickup} → ${route.dropoff}`;
}

export function formatDeliveryDetailPlace(location: LocationLabel) {
  return {
    title: locationTitle(location),
    subtitle: distinctParts([location.district, location.street, location.city, location.province])
      .filter((part) => !samePart(part, localPart(location)))
      .join(" / ") || location.formattedAddress || "Coordonnées GPS enregistrées",
  };
}

export function formatFavoritePlace(location: LocationLabel) {
  return localPart(location);
}

export function formatNavigationTarget(location: LocationLabel) {
  return location.formattedAddress || distinctParts([localPart(location), location.street, location.district, location.city, location.province, location.country]).join(", ");
}

/** @deprecated Utiliser formatListRoute. */
export const compactRouteLabel = formatListRoute;
/** @deprecated Utiliser formatDeliveryDetailPlace. */
export const detailedPlaceLabel = (location: LocationLabel) => {
  const formatted = formatDeliveryDetailPlace(location);
  return `${formatted.title}${formatted.subtitle ? ` / ${formatted.subtitle}` : ""}`;
};
/** @deprecated Utiliser formatDeliveryDetailPlace. */
export const displayLocation = (location: LocationLabel) => {
  const formatted = formatDeliveryDetailPlace(location);
  return `${formatted.title}${formatted.subtitle ? ` · ${formatted.subtitle.replaceAll(" / ", " · ")}` : ""}`;
};

export function geodesicDistanceKm(origin: Pick<LocationLabel, "latitude" | "longitude">, destination: Pick<LocationLabel, "latitude" | "longitude">) {
  const radians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371.0088;
  const latitudeDelta = radians(destination.latitude - origin.latitude);
  const longitudeDelta = radians(destination.longitude - origin.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(radians(origin.latitude)) * Math.cos(radians(destination.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function provisionalRoute(origin: Pick<LocationLabel, "latitude" | "longitude">, destination: Pick<LocationLabel, "latitude" | "longitude">) {
  const directDistance = geodesicDistanceKm(origin, destination);
  const distanceKm = Math.max(0.5, Math.ceil(directDistance * 1.28 * 10) / 10);
  const durationMinutes = Math.max(4, Math.ceil((distanceKm / 22) * 60));
  return { distanceKm, durationMinutes, precise: false as const, source: "provisional" as const };
}

export type EstimationInput = {
  distanceKm: number;
  durationMinutes?: number;
  type: DeliveryType;
  vehicle: SelectableVehicleType;
  weightKg?: number;
  dimensions?: { lengthCm?: number; widthCm?: number; heightCm?: number };
  passengers?: number;
};

export type PricingRateConfig = {
  vehicles: Record<string, { minimum: number; perKm: number }>;
  typeAdjustment: { plis: number; personnePerPassenger: number };
};

const DEFAULT_VEHICLE_RATE: Record<SelectableVehicleType, { minimum: number; perKm: number }> = {
  "Vélo": { minimum: 500, perKm: 115 },
  "Moto": { minimum: 750, perKm: 165 },
  "Tricycle": { minimum: 1100, perKm: 220 },
  "Voiture": { minimum: 1600, perKm: 290 },
};

export function estimateDeliveryPrice(input: EstimationInput, config?: PricingRateConfig) {
  const rate = config?.vehicles[input.vehicle] ?? DEFAULT_VEHICLE_RATE[input.vehicle];
  const distance = Math.max(0, input.distanceKm);
  const routeBase = rate.minimum + Math.ceil(distance * rate.perKm);
  const durationAdjustment = input.durationMinutes ? Math.min(1200, Math.max(0, input.durationMinutes - distance * 2) * 18) : 0;
  const plisAdjustment = config?.typeAdjustment.plis ?? 180;
  const personnePerPassenger = config?.typeAdjustment.personnePerPassenger ?? 240;
  const typeAdjustment = input.type === "Plis" ? plisAdjustment : input.type === "Personne" ? Math.max(1, Math.min(4, input.passengers ?? 1)) * personnePerPassenger : cargoAdjustment(input.weightKg, input.dimensions);
  return Math.ceil((routeBase + durationAdjustment + typeAdjustment) / 50) * 50;
}

function cargoAdjustment(weightKg = 0, dimensions?: { lengthCm?: number; widthCm?: number; heightCm?: number }) {
  const safeWeight = Math.max(0, Math.min(weightKg, 500));
  const volumeM3 = dimensions?.lengthCm && dimensions?.widthCm && dimensions?.heightCm ? (dimensions.lengthCm * dimensions.widthCm * dimensions.heightCm) / 1_000_000 : 0;
  return 280 + Math.min(1800, safeWeight * 22) + Math.min(2600, volumeM3 * 5200);
}

export function validateDeliveryMeasurement(type: DeliveryType, input: { weightKg?: number; passengers?: number; dimensions?: { lengthCm?: number; widthCm?: number; heightCm?: number } }) {
  if (type === "Personne" && (!Number.isInteger(input.passengers) || (input.passengers ?? 0) < 1 || (input.passengers ?? 0) > 4)) return "Indiquez un nombre de personnes entre 1 et 4.";
  if (type === "Autre" && input.weightKg !== undefined && (input.weightKg < 0 || input.weightKg > 500)) return "Le poids doit être compris entre 0 et 500 kg.";
  for (const value of Object.values(input.dimensions ?? {})) if (value !== undefined && (value <= 0 || value > 1000)) return "Chaque dimension doit être comprise entre 1 et 1 000 cm.";
  return null;
}
