/**
 * Périmètre de travail d'un livreur : quelles courses lui sont montrées, et pour lesquelles il est
 * alerté par notification push.
 *
 * Deux périmètres indépendants, réglables séparément par le livreur :
 *  - `discoveryRadiusKm` : rayon d'affichage des opportunités dans l'app ;
 *  - `alertRadiusKm`     : rayon au-delà duquel une nouvelle course ne déclenche plus d'alerte push.
 *
 * Dans les deux cas, `null` signifie « ma ville » — c'est le réglage par défaut : un livreur qui n'a
 * jamais ouvert ses préférences ne voit et n'est alerté que pour les courses dont le point de
 * récupération est dans sa propre ville. Un rayon en km ne s'applique que si l'on connaît un point de
 * référence (dernière position GPS enregistrée par le livreur) ; sans ce point, on retombe
 * volontairement sur la ville plutôt que d'ouvrir le périmètre à tout le pays.
 */

export type DriverPerimeterPreferences = {
  /** Opt-in explicite aux alertes push de nouvelles courses. N'affecte jamais les notifications
   *  transactionnelles (candidature retenue, mission confirmée, course annulée…), qui restent dues. */
  opportunityPushEnabled: boolean;
  /** `null` = ma ville. Sinon rayon max en km autour du point de référence. */
  alertRadiusKm: number | null;
  /** `null` = ma ville. Sinon rayon max en km autour du point de référence. */
  discoveryRadiusKm: number | null;
  /** Dernière position connue du livreur, servant de centre aux deux rayons. */
  baseLatitude: number | null;
  baseLongitude: number | null;
  baseUpdatedAt: string | null;
};

export const DEFAULT_DRIVER_PERIMETER: DriverPerimeterPreferences = {
  opportunityPushEnabled: false,
  alertRadiusKm: null,
  discoveryRadiusKm: null,
  baseLatitude: null,
  baseLongitude: null,
  baseUpdatedAt: null,
};

/** Valeurs proposées dans l'interface. `null` (ma ville) est toujours la première option. */
export const PERIMETER_RADIUS_OPTIONS_KM = [5, 10, 20, 50, 100] as const;

export const MIN_PERIMETER_RADIUS_KM = 1;
export const MAX_PERIMETER_RADIUS_KM = 200;

/** Au-delà, le point de référence est considéré comme trop ancien pour arbitrer un rayon : on
 *  repasse sur la ville. Un livreur qui a fermé l'app depuis une semaine n'est plus forcément là. */
export const BASE_POSITION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export function isValidPerimeterRadius(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_PERIMETER_RADIUS_KM && value <= MAX_PERIMETER_RADIUS_KM;
}

/** Comparaison de noms de villes tolérante aux accents, à la casse, aux tirets et aux espaces :
 *  « Ouagadougou » et « ouagadougou » désignent la même ville, tout comme « Bobo-Dioulasso » et
 *  « Bobo Dioulasso ». Les villes proviennent de sources différentes (saisie profil via Mapbox d'un
 *  côté, géocodage du lieu de récupération de l'autre) : une égalité stricte laisserait passer des
 *  faux négatifs silencieux, qui se traduiraient par un livreur ne voyant plus aucune course. */
export function normalizeCityName(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isSameCity(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeCityName(a);
  const right = normalizeCityName(b);
  return left.length > 0 && left === right;
}

export function distanceKmBetween(
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
): number {
  const radians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371.0088;
  const latitudeDelta = radians(destination.latitude - origin.latitude);
  const longitudeDelta = radians(destination.longitude - origin.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(origin.latitude)) * Math.cos(radians(destination.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Rayon de repli du mode « ma ville ». Les noms de villes des deux côtés de la comparaison ne
 * viennent pas de la même source et n'ont pas la même granularité : le profil livreur est saisi via
 * `searchCities` (Mapbox, `types=place,locality`), tandis que `tikis_places.city` retombe sur la
 * région (Mapbox) ou le `county` (OpenStreetMap) quand le géocodeur ne renvoie pas de ville — voir
 * `featureToLocation` et `openStreetMapLocation` dans server/geography.ts. Un livreur de Ouagadougou
 * ne reconnaîtrait donc pas un point stocké sous « Centre » ou « Kadiogo ».
 *
 * Sans ce repli, ces courses seraient invisibles ET sans alerte pour tout le monde, sans que
 * personne ne puisse comprendre pourquoi. Quand on dispose d'une position de référence fraîche, une
 * distance raisonnable tranche donc ce que les libellés ne savent pas trancher.
 */
export const CITY_MODE_FALLBACK_RADIUS_KM = 25;

export type PerimeterDecision = {
  matches: boolean;
  /** Comment la décision a été prise — utile pour l'affichage et les tests. */
  mode: "city" | "radius";
  /** Distance au point de référence quand le mode rayon s'applique. */
  distanceKm: number | null;
};

/**
 * Le point de récupération est-il dans le périmètre du livreur ?
 *
 * @param radiusKm      Rayon choisi, ou `null` pour « ma ville ».
 * @param driverCity    Ville renseignée dans le profil du livreur.
 * @param base          Position de référence du livreur (peut être absente ou périmée).
 * @param pickup        Point de récupération de la course.
 */
export function evaluatePerimeter(input: {
  radiusKm: number | null;
  driverCity: string | null | undefined;
  base: { latitude: number | null; longitude: number | null; updatedAt: string | null } | null;
  pickup: {
    latitude: number;
    longitude: number;
    city: string | null | undefined;
    /** Libellés secondaires du géocodeur : selon la source, la ville réelle peut se retrouver là. */
    district?: string | null;
    province?: string | null;
  };
  now?: number;
}): PerimeterDecision {
  const now = input.now ?? Date.now();
  const base = input.base;
  const hasFreshBase = Boolean(
    base
    && typeof base.latitude === "number"
    && typeof base.longitude === "number"
    && Number.isFinite(base.latitude)
    && Number.isFinite(base.longitude)
    && (base.updatedAt === null || now - new Date(base.updatedAt).getTime() <= BASE_POSITION_MAX_AGE_MS),
  );
  const distanceToBaseKm = hasFreshBase
    ? distanceKmBetween(
      { latitude: base!.latitude as number, longitude: base!.longitude as number },
      { latitude: input.pickup.latitude, longitude: input.pickup.longitude },
    )
    : null;

  if (isValidPerimeterRadius(input.radiusKm) && distanceToBaseKm !== null) {
    return { matches: distanceToBaseKm <= input.radiusKm, mode: "radius", distanceKm: distanceToBaseKm };
  }

  // Mode ville. Sans ville de profil livreur, on n'a aucun critère fiable pour restreindre : on laisse
  // passer plutôt que de masquer toutes les courses à un profil incomplet — masquer est ici l'échec le
  // plus coûteux (plus aucune course visible, sans explication), une course de trop restant ignorable.
  const driverCity = normalizeCityName(input.driverCity);
  if (driverCity.length === 0) return { matches: true, mode: "city", distanceKm: distanceToBaseKm };

  // On compare aux trois libellés du lieu, et pas seulement à `city` : selon le géocodeur, la ville
  // réelle peut être rangée dans `district` (locality Mapbox) tandis que `city` porte la région.
  const pickupLabels = [input.pickup.city, input.pickup.district, input.pickup.province]
    .map(normalizeCityName)
    .filter((label) => label.length > 0);
  if (pickupLabels.includes(driverCity)) return { matches: true, mode: "city", distanceKm: distanceToBaseKm };

  // Aucun libellé exploitable : on ne filtre pas sur une donnée qu'on n'a pas.
  if (pickupLabels.length === 0) return { matches: true, mode: "city", distanceKm: distanceToBaseKm };

  // Les libellés se contredisent, mais la géographie, elle, tranche (cf. CITY_MODE_FALLBACK_RADIUS_KM).
  if (distanceToBaseKm !== null && distanceToBaseKm <= CITY_MODE_FALLBACK_RADIUS_KM) {
    return { matches: true, mode: "city", distanceKm: distanceToBaseKm };
  }
  return { matches: false, mode: "city", distanceKm: distanceToBaseKm };
}

/** Libellé lisible d'un périmètre, pour l'interface. */
export function describePerimeter(radiusKm: number | null, cityName?: string | null): string {
  if (!isValidPerimeterRadius(radiusKm)) {
    const city = (cityName ?? "").trim();
    return city.length > 0 ? `Ma ville (${city})` : "Ma ville";
  }
  return `${radiusKm} km autour de moi`;
}
