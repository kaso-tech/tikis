import type { DeliveryType, LocationLabel, SelectableVehicleType } from "@/shared/tikis-domain";

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
  };
}

function shortPart(location: LocationLabel) {
  return location.name || location.district || location.street || location.city || location.province || location.formattedAddress || "Lieu";
}

export function compactRouteLabel(pickup: LocationLabel, dropoff: LocationLabel) {
  const sameCity = Boolean(pickup.city && dropoff.city && pickup.city.localeCompare(dropoff.city, "fr", { sensitivity: "base" }) === 0);
  return sameCity ? `${shortPart(pickup)} → ${shortPart(dropoff)}` : `${pickup.city || pickup.province || shortPart(pickup)} → ${dropoff.city || dropoff.province || shortPart(dropoff)}`;
}

export function detailedPlaceLabel(location: LocationLabel) {
  const details = [location.name, location.district, location.city, location.province].filter((item): item is string => Boolean(item));
  return details.filter((item, index, values) => values.findIndex((value) => value.localeCompare(item, "fr", { sensitivity: "base" }) === 0) === index).join(" / ") || location.formattedAddress || "Lieu sélectionné";
}

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

const VEHICLE_RATE: Record<SelectableVehicleType, { minimum: number; perKm: number }> = {
  "Vélo": { minimum: 500, perKm: 115 },
  "Moto": { minimum: 750, perKm: 165 },
  "Tricycle": { minimum: 1100, perKm: 220 },
  "Voiture": { minimum: 1600, perKm: 290 },
};

export function estimateDeliveryPrice(input: EstimationInput) {
  const rate = VEHICLE_RATE[input.vehicle];
  const distance = Math.max(0, input.distanceKm);
  const routeBase = rate.minimum + Math.ceil(distance * rate.perKm);
  const durationAdjustment = input.durationMinutes ? Math.min(1200, Math.max(0, input.durationMinutes - distance * 2) * 18) : 0;
  const typeAdjustment = input.type === "Plis" ? 180 : input.type === "Personne" ? Math.max(1, Math.min(4, input.passengers ?? 1)) * 240 : cargoAdjustment(input.weightKg, input.dimensions);
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
