/** Liste des pays supportés avec leur bounding box approximative.
 *  Source : valeurs par défaut. Si on a besoin de plus de précision,
 *  on charge depuis la table `tikis_supported_countries` (migration 0022). */
const COUNTRY_BBOX: Record<string, { minLat: number; maxLat: number; minLng: number; maxLng: number }> = {
  CM: { minLat: 1.65, maxLat: 13.08, minLng: 8.5, maxLng: 16.2 },
  CI: { minLat: 4.36, maxLat: 10.74, minLng: -8.6, maxLng: -2.5 },
  SN: { minLat: 12.3, maxLat: 16.7, minLng: -17.6, maxLng: -11.4 },
  // Pays absents de cette table jusqu'ici alors qu'ils sont dans COUNTRIES (lib/registration-rules.ts) :
  // le géofencing d'updateLivePosition retombait silencieusement sur DEFAULT_ALLOWED_BBOX (toute l'Afrique
  // de l'Ouest/Centre), qui n'écarte donc jamais une position aberrante pour ces pays — cause du suivi
  // livreur affichant une position à ~200 km de la course (voir capture "555 min / 203,5 km").
  BF: { minLat: 9.4, maxLat: 15.1, minLng: -5.5, maxLng: 2.4 },
  ML: { minLat: 10.0, maxLat: 25.0, minLng: -12.2, maxLng: 4.2 },
  TG: { minLat: 6.0, maxLat: 11.2, minLng: -0.2, maxLng: 1.8 },
  GH: { minLat: 4.5, maxLat: 11.2, minLng: -3.3, maxLng: 1.3 },
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
