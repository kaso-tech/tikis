import { useEffect, useRef, useState } from "react";
import { isUsablePoint, pointKey, routeGeometryKey, shouldRefreshApproach, type ApproachAnchor, type Point } from "@/lib/route-refresh";
import { trpc } from "@/lib/trpc";
import type { LocationLabel } from "@/shared/tikis-domain";

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
export function useRouteCoordinates(origin: LocationLabel | null | undefined, destination: LocationLabel | null | undefined): { coordinates: Point[]; isLoading: boolean } {
  const routeMutation = trpc.geography.route.useMutation();
  const requestRef = useRef(routeMutation.mutateAsync);
  requestRef.current = routeMutation.mutateAsync;
  const [coordinates, setCoordinates] = useState<Point[]>([]);
  const endpointsRef = useRef<{ origin: LocationLabel; destination: LocationLabel } | null>(null);
  const requestedKey = useRef<string | null>(null);

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
    const endpoints = endpointsRef.current;
    if (!endpoints) return;
    requestedKey.current = key;
    let active = true;
    setCoordinates((current) => (current.length ? [] : current));
    void requestRef.current({ origin: endpoints.origin, destination: endpoints.destination })
      .then((route) => { if (active) setCoordinates(route.coordinates ?? []); })
      // L'échec n'est pas réessayé en boucle : la carte retombe sur son tracé
      // provisoire, que `DeliveryRouteMap` signale déjà par un trait pointillé.
      .catch(() => { if (active) setCoordinates([]); });
    return () => { active = false; };
  }, [key]);

  return { coordinates, isLoading: routeMutation.isPending };
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
