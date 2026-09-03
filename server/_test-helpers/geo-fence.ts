/** Liste des pays supportés avec leur bounding box approximative.
 *  Source : valeurs par défaut. Si on a besoin de plus de précision,
 *  on charge depuis la table `tikis_supported_countries` (migration 0022). */
const COUNTRY_BBOX: Record<string, { minLat: number; maxLat: number; minLng: number; maxLng: number }> = {
  CM: { minLat: 1.65, maxLat: 13.08, minLng: 8.5, maxLng: 16.2 },
  CI: { minLat: 4.36, maxLat: 10.74, minLng: -8.6, maxLng: -2.5 },
  SN: { minLat: 12.3, maxLat: 16.7, minLng: -17.6, maxLng: -11.4 },
};

/** Bbox d'erreur si le pays n'est pas dans la whitelist.
 *  Très large (englobe l'Afrique de l'Ouest + Centre) pour ne pas rejeter
 *  les pays frontaliers que Tikis pourrait servir en pilote. */
const DEFAULT_ALLOWED_BBOX = { minLat: -10, maxLat: 25, minLng: -20, maxLng: 25 };

/** Renvoie true si la coordonnée est dans la bbox du pays. */
export function isCoordinateInCountry(latitude: number, longitude: number, countryCode: string): boolean {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;
  const bbox = COUNTRY_BBOX[countryCode.toUpperCase()] ?? DEFAULT_ALLOWED_BBOX;
  return latitude >= bbox.minLat && latitude <= bbox.maxLat && longitude >= bbox.minLng && longitude <= bbox.maxLng;
}

/** Liste des pays dont la bbox est connue. */
export function listSupportedCountries(): string[] {
  return Object.keys(COUNTRY_BBOX);
}
