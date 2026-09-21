/**
 * Ce qu'un livreur voit d'une course qui ne lui est pas encore attribuée.
 *
 * L'adresse exacte ne lui appartient pas tant qu'il n'a pas la course : ni la
 * porte, ni la rue, ni l'identifiant du lieu. Mais la masquer jusqu'à la ville
 * revenait à afficher « Ouagadougou → Ouagadougou » sur chaque annonce d'une
 * même ville — trois offres identiques dans la liste, et rien pour décider
 * laquelle prendre.
 *
 * Le quartier est le bon niveau : il dit au livreur si la course est de son
 * côté de la ville, et il ne désigne personne. C'est aussi celui que la
 * logique métier attend d'une liste (docs/logique-metier-lieux.md §7.1 :
 * « Karpala → Ouaga 2000 »).
 *
 * Un lieu public garde son nom — « Maison du Peuple » est un point de
 * rendez-vous, pas un domicile, et c'est le premier choix du §7.1. Il se
 * reconnaît au `featureType` « poi », que le serveur renseigne pour tout lieu
 * enregistré ; les autres deviennent leur quartier.
 *
 * Les coordonnées suivent le même niveau : arrondies au centième de degré,
 * soit environ un kilomètre. Au dixième, l'écart atteignait une dizaine de
 * kilomètres — à l'échelle d'une ville, la distance « à X km de vous » et le
 * tracé indicatif contredisaient le quartier annoncé juste à côté.
 */

/** Le pas d'arrondi des coordonnées indicatives, en degrés (~1,1 km). */
export const APPROXIMATE_COORDINATE_STEP = 0.01;

type ConcealablePlace = {
  name: string;
  district: string;
  city: string;
  latitude: number;
  longitude: number;
  street?: string;
  formattedAddress?: string;
  googlePlaceId?: string;
  mapboxId?: string;
  mapboxSessionToken?: string;
  featureType?: "address" | "secondary_address" | "poi" | "street" | "neighborhood" | "locality" | "place" | "point" | "unknown";
  precision?: "exact" | "street" | "area" | "city" | "unknown";
};

/** Arrondit une coordonnée au pas indicatif, sans introduire d'erreur de virgule flottante visible. */
export function approximateCoordinate(value: number) {
  const steps = Math.round(value / APPROXIMATE_COORDINATE_STEP);
  return Number((steps * APPROXIMATE_COORDINATE_STEP).toFixed(2));
}

export function concealPlaceForDriver<T extends ConcealablePlace>(place: T): T {
  const area = place.district || place.city || "Zone indicative";
  // Hors lieu public, le nom peut désigner une personne autant qu'un lieu
  // (« Villa 32, chez Awa ») : il tombe, et le quartier prend sa place.
  const isPublicPlace = place.featureType === "poi" && Boolean(place.name);
  return {
    ...place,
    name: isPublicPlace ? place.name : area,
    street: undefined,
    formattedAddress: [isPublicPlace ? place.name : "", place.district, place.city].filter(Boolean).join(", ") || area,
    googlePlaceId: undefined,
    mapboxId: undefined,
    mapboxSessionToken: undefined,
    latitude: approximateCoordinate(place.latitude),
    longitude: approximateCoordinate(place.longitude),
    featureType: isPublicPlace ? ("poi" as const) : ("neighborhood" as const),
    precision: "area" as const,
  };
}
