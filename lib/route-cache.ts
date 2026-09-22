/**
 * Les itinéraires déjà obtenus, gardés entre deux montages d'écran.
 *
 * Un tracé entre deux points fixes ne change pas : le redemander à chaque
 * ouverture de la fiche de livraison ne rapporte rien, et coûte au contraire
 * un aller-retour réseau pendant lequel la carte n'a qu'une ligne droite à
 * montrer. Pire, l'écran de suivi en direct et la fiche sont deux écrans
 * distincts : passer de l'un à l'autre démontait l'état du hook, et le retour
 * repartait de zéro.
 *
 * Le cache vit au niveau du module, donc au niveau de l'application : il
 * survit aux montages, et un retour sur un écran déjà visité redessine le
 * vrai tracé immédiatement, sans requête.
 */

// Import relatif et non par alias : ce module est couvert par des tests qui
// l'exécutent hors du bundler, lequel est seul à résoudre « @/ ».
import type { Point } from "./route-refresh";

/** Au-delà, les entrées les plus anciennes sont oubliées. Quelques dizaines
 *  d'itinéraires couvrent largement une session d'utilisation ; garder tout
 *  ferait grossir la mémoire sans fin sur un téléphone d'entrée de gamme. */
export const ROUTE_CACHE_LIMIT = 40;

const cache = new Map<string, Point[]>();

/** Le tracé mémorisé pour cette géométrie, ou `null` s'il n'y en a pas. */
export function readCachedRoute(key: string): Point[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  // Relecture = usage récent : l'entrée repasse en queue pour survivre à l'éviction.
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

/**
 * Mémorise un tracé.
 *
 * Un tracé d'un seul point — ou vide — n'est pas un itinéraire : le mémoriser
 * ferait servir un échec comme s'il était une réponse, et plus aucune requête
 * ne serait tentée pour cette géométrie.
 */
export function writeCachedRoute(key: string, coordinates: Point[]): void {
  if (coordinates.length < 2) return;
  cache.delete(key);
  cache.set(key, coordinates);
  while (cache.size > ROUTE_CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/** Vide le cache. Réservé aux tests : rien dans l'application n'invalide un
 *  itinéraire, puisque deux points fixes gardent le même trajet. */
export function clearRouteCache(): void {
  cache.clear();
}
