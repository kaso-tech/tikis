import { useEffect, useRef, useState } from "react";
import { readCachedRoute, writeCachedRoute } from "@/lib/route-cache";
import { isUsablePoint, pointKey, routeGeometryKey, shouldRefreshApproach, type ApproachAnchor, type Point } from "@/lib/route-refresh";
import { trpc } from "@/lib/trpc";
import type { LocationLabel } from "@/shared/tikis-domain";

/** Reprises après échec, et attente avant chacune. Trois essais espacés
 *  couvrent une coupure réseau passagère ou un pic de latence sans transformer
 *  un incident en martèlement du serveur. */
export const ROUTE_RETRY_DELAYS_MS = [1_500, 4_000, 10_000] as const;
export const ROUTE_MAX_ATTEMPTS = ROUTE_RETRY_DELAYS_MS.length;

/** Un point GPS habillé en lieu, seul format accepté par `geography.route`. */
function asPlace(point: Point, name: string): LocationLabel {
  return { name, district: "", city: "", latitude: point.latitude, longitude: point.longitude };
}

/**
 * L'itinéraire entre deux extrémités fixes, demandé une fois par géométrie.
 *
 * Tant que les deux points ne bougent pas, le tracé obtenu reste affiché : ni
 * effacement, ni nouvelle requête, quelles que soient les revalidations de la
 * requête qui a fourni la livraison. C'est ce qui manquait à la fiche de
 * livraison, dont l'itinéraire redevenait une ligne droite au retour du suivi
 * en direct.
 */
export function useRouteCoordinates(origin: LocationLabel | null | undefined, destination: LocationLabel | null | undefined): { coordinates: Point[]; isLoading: boolean; hasFailed: boolean } {
  const routeMutation = trpc.geography.route.useMutation();
  const requestRef = useRef(routeMutation.mutateAsync);
  requestRef.current = routeMutation.mutateAsync;
  const [coordinates, setCoordinates] = useState<Point[]>([]);
  const endpointsRef = useRef<{ origin: LocationLabel; destination: LocationLabel } | null>(null);
  const requestedKey = useRef<string | null>(null);
  /** Compteur de reprises : le faire changer relance l'effet à géométrie
   *  constante, seule façon de retenter après un échec. */
  const [attempt, setAttempt] = useState(0);
  /** Vrai une fois les reprises épuisées : l'écran peut alors dire que le
   *  tracé affiché n'est qu'indicatif, au lieu de le laisser passer pour vrai. */
  const [hasFailed, setHasFailed] = useState(false);
  const attemptsForKey = useRef<{ key: string; count: number }>({ key: "", count: 0 });
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const usable = isUsablePoint(origin) && isUsablePoint(destination);
  if (usable) endpointsRef.current = { origin: origin as LocationLabel, destination: destination as LocationLabel };
  const key = usable ? routeGeometryKey(origin as Point, destination as Point) : null;

  useEffect(() => {
    if (!key) {
      requestedKey.current = null;
      setCoordinates((current) => (current.length ? [] : current));
      return;
    }
    // Même géométrie qu'au dernier appel : le tracé en place reste le bon.
    if (requestedKey.current === key) return;
    // Déjà obtenu plus tôt dans la session — au premier passage sur la fiche,
    // ou sur l'écran de suivi, qui est un écran distinct : on le redessine sans
    // requête, donc sans ligne droite intermédiaire.
    const cached = readCachedRoute(key);
    if (cached) {
      requestedKey.current = key;
      setHasFailed(false);
      setCoordinates(cached);
      return;
    }
    const endpoints = endpointsRef.current;
    if (!endpoints) return;
    requestedKey.current = key;
    let active = true;
    setCoordinates((current) => (current.length ? [] : current));
    void requestRef.current({ origin: endpoints.origin, destination: endpoints.destination })
      .then((route) => {
        const coordinates = route.coordinates ?? [];
        writeCachedRoute(key, coordinates);
        if (!active) return;
        setHasFailed(false);
        setCoordinates(coordinates);
      })
      .catch(() => {
        // La demande n'a pas abouti : on efface la marque, sans quoi la clé
        // resterait notée comme « déjà demandée » et plus aucun rendu ne
        // retenterait. C'est ce qui figeait la carte sur sa ligne droite
        // jusqu'à la fermeture de l'écran, pour un seul échec réseau.
        if (requestedKey.current === key) requestedKey.current = null;
        if (!active) return;
        setCoordinates([]);
        const tally = attemptsForKey.current.key === key ? attemptsForKey.current : { key, count: 0 };
        if (tally.count >= ROUTE_MAX_ATTEMPTS) {
          setHasFailed(true);
          // Épuisé : la carte garde son tracé provisoire, que `DeliveryRouteMap`
          // signale par un trait pointillé. Inutile de marteler le réseau.
          attemptsForKey.current = tally;
          return;
        }
        attemptsForKey.current = { key, count: tally.count + 1 };
        retryTimer.current = setTimeout(() => setAttempt((value) => value + 1), ROUTE_RETRY_DELAYS_MS[tally.count]);
      });
    return () => {
      active = false;
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [attempt, key]);

  return { coordinates, isLoading: routeMutation.isPending, hasFailed };
}

/**
 * L'approche : du livreur au point de récupération.
 *
 * Son origine bouge en continu, donc elle n'est pas mémorisable par géométrie ;
 * elle est recalculée seulement quand le livreur s'est réellement déplacé, ou
 * quand le tracé date. En cas d'échec, un segment droit vaut mieux que rien :
 * la direction reste juste, seule la forme de la rue manque.
 */
export function useApproachRoute({ from, to, enabled }: { from: Point | null | undefined; to: LocationLabel | null | undefined; enabled: boolean }): Point[] {
  const routeMutation = trpc.geography.route.useMutation();
  const requestRef = useRef(routeMutation.mutateAsync);
  requestRef.current = routeMutation.mutateAsync;
  const [coordinates, setCoordinates] = useState<Point[]>([]);
  const destinationRef = useRef<LocationLabel | null>(null);
  const anchor = useRef<(ApproachAnchor & { destination: string }) | null>(null);

  const active = enabled && isUsablePoint(from) && isUsablePoint(to);
  if (active) destinationRef.current = to as LocationLabel;
  const fromLatitude = active ? (from as Point).latitude : null;
  const fromLongitude = active ? (from as Point).longitude : null;
  const destinationKey = active ? pointKey(to as Point) : null;

  useEffect(() => {
    if (fromLatitude === null || fromLongitude === null || !destinationKey) {
      anchor.current = null;
      setCoordinates((current) => (current.length ? [] : current));
      return;
    }
    const origin = { latitude: fromLatitude, longitude: fromLongitude };
    const previous = anchor.current;
    const sameDestination = previous?.destination === destinationKey;
    if (sameDestination && !shouldRefreshApproach(previous, origin, Date.now())) return;
    const destination = destinationRef.current;
    if (!destination) return;
    anchor.current = { ...origin, at: Date.now(), destination: destinationKey };
    let alive = true;
    void requestRef.current({ origin: asPlace(origin, "Position du livreur"), destination })
      .then((route) => { if (alive) setCoordinates(route.coordinates ?? []); })
      .catch(() => { if (alive) setCoordinates([origin, { latitude: destination.latitude, longitude: destination.longitude }]); });
    return () => { alive = false; };
    // L'âge maximal du tracé ne borne que sa fraîcheur, pas le déclenchement :
    // c'est le point GPS suivant qui relance l'effet et le fait constater.
  }, [destinationKey, fromLatitude, fromLongitude]);

  return coordinates;
}
