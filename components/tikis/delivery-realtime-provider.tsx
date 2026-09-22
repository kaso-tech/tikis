import { useEffect, useMemo } from "react";
import type { PropsWithChildren } from "react";
import { subscribeToDeliveryChannel } from "@/lib/supabase-tracking";
import { presentDeliveryStatusPush } from "@/lib/simulated-push-notifications";
import { startBackgroundDriverTracking, stopBackgroundDriverTracking } from "@/lib/background-location-task";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";

/** Subscribes only to deliveries where the profile is a real participant (server-side channel
 *  membership only ever includes the sender and the assigned driver, cf. syncDeliveryParticipants) —
 *  database queries remain the durable fallback. */
export function DeliveryRealtimeProvider({ children }: PropsWithChildren) {
  const { profile, role } = useTikisStore();
  const utilities = trpc.useUtils();
  const deliveriesQuery = trpc.deliveries.list.useQuery(undefined, { enabled: Boolean(profile?.phone), refetchInterval: 12_000 });
  const deliveryIds = useMemo(() => {
    const deliveries = deliveriesQuery.data ?? [];
    // Pour un livreur, `deliveries.list` renvoie aussi toutes les livraisons "open" simplement
    // compatibles avec son engin (pas seulement les siennes) : s'y abonner ouvrirait un canal que la
    // RLS rejette systématiquement (aucune adhésion serveur tant qu'il n'est pas le livreur assigné) —
    // juste du bruit et des cycles d'ouverture/fermeture à chaque rafraîchissement de la liste.
    const participating = role === "driver" ? deliveries.filter((delivery) => delivery.driverId === profile?.phone) : deliveries;
    return participating.map((delivery) => delivery.id).sort();
  }, [deliveriesQuery.data, role, profile?.phone]);
  const deliveryKey = deliveryIds.join("|");

  // Au premier plan, la position part depuis home-screen.native.tsx tant que l'écran d'accueil a
  // le focus. Cet effet-ci prend le relais en arrière-plan (écran verrouillé, application
  // suspendue) : une seule course active à la fois, cf. l'audience de ce provider. `deliveries.list`
  // (déjà interrogée ci-dessus) reste la source de vérité — pas de requête supplémentaire.
  const activeDriverDeliveryId = useMemo(() => {
    const deliveries = deliveriesQuery.data ?? [];
    if (role !== "driver") return null;
    return deliveries.find((delivery) => delivery.status === "active" && delivery.driverId === profile?.phone)?.id ?? null;
  }, [deliveriesQuery.data, role, profile?.phone]);

  useEffect(() => {
    // Ne s'arrête jamais ici au démontage : le suivi en arrière-plan doit justement survivre à la
    // disparition de l'arbre React (écran verrouillé, application suspendue). Cet effet ne fait que
    // suivre l'état réel de la course — actif ou non — la source d'arrêt légitime.
    if (!activeDriverDeliveryId) {
      void stopBackgroundDriverTracking();
      return;
    }
    void startBackgroundDriverTracking(activeDriverDeliveryId);
  }, [activeDriverDeliveryId]);

  useEffect(() => {
    if (!deliveryIds.length) return;
    const unsubscribes = deliveryIds.map((deliveryId) => subscribeToDeliveryChannel(deliveryId, {
      onStatus: (event) => {
        void Promise.all([
          utilities.deliveries.get.invalidate({ id: event.deliveryId }),
          // Sans ceci, une feuille de candidatures déjà ouverte ne reflétait jamais une nouvelle
          // candidature, un retrait, une sélection ou un remplacement sans rafraîchissement manuel.
          utilities.deliveries.candidates.invalidate({ deliveryId: event.deliveryId }),
          utilities.deliveries.list.invalidate(),
          utilities.notifications.list.invalidate(),
          utilities.wallet.snapshot.invalidate(),
        ]);
        void presentDeliveryStatusPush(event);
      },
    }));
    return () => { unsubscribes.forEach((unsubscribe) => unsubscribe()); };
  }, [deliveryIds, deliveryKey, utilities]);

  return <>{children}</>;
}
