import { useEffect, useRef } from "react";

import { trpc } from "@/lib/trpc";
import { distanceKmBetween } from "@/shared/driver-perimeter";

/** Fréquence maximale de republication : le périmètre d'un livreur n'a pas besoin d'être recalculé à
 *  la seconde, et chaque envoi consomme le rate-limit géographique partagé. */
const MIN_SYNC_INTERVAL_MS = 15 * 60 * 1_000;
/** En dessous, le livreur n'a pas bougé assez pour changer quoi que ce soit à un rayon en kilomètres. */
const MIN_SYNC_DISTANCE_KM = 2;

type Position = { latitude: number; longitude: number };

/**
 * Tient à jour la position de référence servant de centre aux rayons du livreur (cf.
 * shared/driver-perimeter.ts), à partir du point GPS déjà obtenu par l'écran d'accueil.
 *
 * Silencieux par construction : un refus du géofencing serveur ou une absence de GPS ne doit jamais
 * interrompre l'écran d'accueil — le périmètre retombe simplement sur la ville du profil.
 */
export function useDriverBasePositionSync(location: Position | null, enabled: boolean) {
  const updateBasePosition = trpc.driverPerimeter.updateBasePosition.useMutation();
  const lastSyncedAt = useRef(0);
  const lastSyncedPosition = useRef<Position | null>(null);
  const mutateRef = useRef(updateBasePosition.mutateAsync);
  mutateRef.current = updateBasePosition.mutateAsync;

  useEffect(() => {
    if (!enabled || !location) return;
    const now = Date.now();
    const movedEnough = lastSyncedPosition.current === null
      || distanceKmBetween(lastSyncedPosition.current, location) >= MIN_SYNC_DISTANCE_KM;
    if (!movedEnough && now - lastSyncedAt.current < MIN_SYNC_INTERVAL_MS) return;

    // Marqué avant l'appel : en cas d'échec, on ne veut pas réessayer à chaque rendu (le géofencing
    // refuse par exemple durablement une position hors zone de service).
    lastSyncedAt.current = now;
    lastSyncedPosition.current = location;
    void mutateRef.current({ latitude: location.latitude, longitude: location.longitude }).catch(() => {});
  }, [enabled, location]);
}
