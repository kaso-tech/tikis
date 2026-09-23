/**
 * Quand redemander un itinéraire, et sous quelle clé le mémoriser.
 *
 * Les écrans de carte demandaient leur tracé dans un `useEffect` dont la
 * dépendance était l'objet livraison. Une simple revalidation tRPC — au retour
 * sur l'écran, par exemple — rend un objet neuf : l'effet repartait, vidait le
 * tracé, et la carte retombait sur la ligne droite le temps d'un aller-retour
 * réseau. Si ce nouvel appel échouait, elle y restait.
 *
 * La clé d'un itinéraire est donc sa géométrie, jamais l'identité de l'objet
 * qui la transporte : tant que les deux extrémités ne bougent pas, le tracé
 * déjà obtenu reste valable et aucune requête n'est refaite.
 */

// Import relatif et non par alias : ce module est couvert par des tests qui
// l'exécutent hors du bundler, lequel est seul à résoudre « @/ ».
import { geodesicDistanceKm } from "./geo-rules";

export type Point = { latitude: number; longitude: number };

/** Distance parcourue par le livreur avant de recalculer son approche. C'est le vrai déclencheur :
 *  un tracé ne change que lorsque son origine bouge. */
export const APPROACH_MIN_MOVE_METERS = 80;
/**
 * Âge au-delà duquel l'approche est recalculée même à l'arrêt.
 *
 * Une minute, et non quinze secondes : à l'arrêt le tracé ne change pas, seule sa durée estimée
 * bouge avec le trafic. Or chaque recalcul est un appel Mapbox Directions facturé, et il échappe
 * au cache serveur — la gigue GPS suffit à déplacer l'origine au-delà du mètre qui distingue deux
 * clés de cache. À quinze secondes, une approche de vingt minutes en coûtait quatre-vingts, pour
 * chaque écran qui l'affiche (celui du livreur et celui de l'expéditeur qui le suit).
 */
export const APPROACH_MAX_AGE_MS = 60_000;

/** Vrai si les deux coordonnées sont exploitables pour tracer quoi que ce soit. */
export function isUsablePoint(point: Point | null | undefined): point is Point {
  return Boolean(point) && Number.isFinite(point!.latitude) && Number.isFinite(point!.longitude);
}

/**
 * La clé d'un couple de points, arrondie au mètre environ.
 *
 * L'arrondi absorbe les écarts de sérialisation (une décimale de plus au
 * retour de la base) qui feraient conclure à tort que le trajet a changé.
 */
export function pointKey(point: Point): string {
  return `${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`;
}

export function routeGeometryKey(origin: Point, destination: Point): string {
  return `${pointKey(origin)}>${pointKey(destination)}`;
}

export type ApproachAnchor = Point & { at: number };

/**
 * Faut-il recalculer l'approche livreur → récupération ?
 *
 * Oui s'il a bougé de façon significative, oui si le tracé date ; non sinon.
 * Sans ce garde-fou, chaque point GPS reçu déclencherait une requête pour un
 * tracé qui ne changerait quasiment pas.
 */
export function shouldRefreshApproach(previous: ApproachAnchor | null, next: Point, now: number): boolean {
  if (!previous) return true;
  if (now - previous.at >= APPROACH_MAX_AGE_MS) return true;
  return geodesicDistanceKm(previous, next) * 1_000 >= APPROACH_MIN_MOVE_METERS;
}
