import type { LocationLabel } from "@/shared/tikis-domain";

export type StoredFavoritePlace = {
  id: number | string;
  label: string;
  place: {
    placeName: string;
    district: string | null;
    city: string | null;
    latitude: string;
    longitude: string;
    googlePlaceId: string | null;
    mapboxPlaceId: string | null;
    formattedAddress: string;
    street: string | null;
    province: string | null;
    country: string | null;
    provider: string;
    source: string;
    featureType: string;
    precision: string;
  };
};

export function toPlacePayload(place: LocationLabel) {
  return {
    name: place.name,
    district: place.district,
    city: place.city,
    latitude: place.latitude,
    longitude: place.longitude,
    ...(place.googlePlaceId ? { googlePlaceId: place.googlePlaceId } : {}),
    ...(place.mapboxId ? { mapboxId: place.mapboxId } : {}),
    ...(place.mapboxSessionToken ? { mapboxSessionToken: place.mapboxSessionToken } : {}),
    ...(place.formattedAddress ? { formattedAddress: place.formattedAddress } : {}),
    ...(place.street ? { street: place.street } : {}),
    ...(place.province ? { province: place.province } : {}),
    ...(place.country ? { country: place.country } : {}),
    ...(place.source ? { source: place.source } : {}),
    // Sans ceci, un lieu déjà classifié en mémoire (ex. un POI communautaire hors index Mapbox Suggest)
    // perdrait sa classification à la première écriture en base — voir server/routers.ts (placeSchema).
    ...(place.featureType ? { featureType: place.featureType } : {}),
    ...(place.precision ? { precision: place.precision } : {}),
  };
}

export function favoriteToLocation(item: Pick<StoredFavoritePlace, "place">): LocationLabel {
  const place = item.place;
  const provider = ["mapbox", "openstreetmap", "manual", "legacy"].includes(place.provider)
    ? place.provider as LocationLabel["provider"]
    : "legacy";
  const source = ["search", "retrieve", "reverse", "forward", "favorite", "manual", "legacy"].includes(place.source)
    ? place.source as LocationLabel["source"]
    : "legacy";
  const featureType = ["address", "secondary_address", "poi", "street", "neighborhood", "locality", "place", "point", "unknown"].includes(place.featureType)
    ? place.featureType as LocationLabel["featureType"]
    : "unknown";
  const precision = ["exact", "street", "area", "city", "unknown"].includes(place.precision)
    ? place.precision as LocationLabel["precision"]
    : "unknown";

  return {
    name: place.placeName,
    district: place.district ?? "",
    city: place.city ?? "",
    latitude: Number(place.latitude),
    longitude: Number(place.longitude),
    ...(place.googlePlaceId ? { googlePlaceId: place.googlePlaceId } : {}),
    ...(place.mapboxPlaceId ? { mapboxId: place.mapboxPlaceId } : {}),
    ...(place.formattedAddress ? { formattedAddress: place.formattedAddress } : {}),
    ...(place.street ? { street: place.street } : {}),
    ...(place.province ? { province: place.province } : {}),
    ...(place.country ? { country: place.country } : {}),
    provider,
    source,
    featureType,
    precision,
  };
}
