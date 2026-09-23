/**
 * Suivi de position du livreur en arrière-plan.
 *
 * `hooks/use-driver-location.ts` (au premier plan) et l'effet de publication de
 * `home-screen.native.tsx` s'arrêtent dès que l'écran perd le focus ou que
 * l'application passe en arrière-plan : `watchPositionAsync` est un abonnement
 * JS ordinaire, que l'OS suspend avec le reste du moteur React Native. Pendant
 * ce temps, le suivi en direct de l'expéditeur se fige.
 *
 * `Location.startLocationUpdatesAsync` fonctionne autrement : il enregistre
 * une tâche côté OS (`TaskManager`), que l'OS réveille lui-même pour livrer de
 * nouveaux points, même écran verrouillé ou application fermée au premier
 * plan. `defineTask` doit être appelé une seule fois, tôt, en dehors de tout
 * composant — ce module est importé une fois depuis app/_layout.tsx pour ça.
 *
 * La tâche s'exécute hors de tout arbre React : elle ne peut pas lire l'état
 * d'un composant. La livraison actuellement suivie est donc persistée dans
 * AsyncStorage par `startBackgroundDriverTracking`/`stopBackgroundDriverTracking`,
 * et relue à chaque réveil.
 */
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { createTRPCClient, httpLink, TRPCClientError } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/server/routers";
import { getApiBaseUrl } from "@/constants/oauth";
import { getTikisSessionToken } from "@/lib/tikis-session";
import { safeHeading } from "@/lib/background-location-rules";
import { LIVE_POSITION_GPS_JUMP_ERR_MSG, LIVE_POSITION_OUT_OF_ZONE_ERR_MSG } from "@/shared/const";

export const BACKGROUND_DRIVER_LOCATION_TASK = "tikis-driver-background-location";
const ACTIVE_DELIVERY_STORAGE_KEY = "tikis:background-tracking:active-delivery-id";

/** Client tRPC autonome, sans lien avec le Provider React (indisponible dans une tâche de
 *  fond) : un seul appel isolé, jamais groupé avec quoi que ce soit d'autre. */
function createBackgroundClient(sessionToken: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: `${getApiBaseUrl()}/api/trpc`,
        transformer: superjson,
        headers: () => ({ "x-tikis-session": sessionToken }),
      }),
    ],
  });
}

if (Platform.OS !== "web") {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(BACKGROUND_DRIVER_LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      console.error("[background-location] tâche en erreur", error);
      return;
    }
    const latest = data?.locations?.at(-1);
    if (!latest) return;
    try {
      // Pas de livraison suivie : `stopBackgroundDriverTracking` aurait dû arrêter la tâche,
      // mais un dernier réveil peut arriver juste après — rien à publier dans ce cas.
      const deliveryId = await AsyncStorage.getItem(ACTIVE_DELIVERY_STORAGE_KEY);
      if (!deliveryId) return;
      const sessionToken = await getTikisSessionToken();
      if (!sessionToken) return;
      await createBackgroundClient(sessionToken).deliveries.updateLivePosition.mutate({
        deliveryId,
        latitude: latest.coords.latitude,
        longitude: latest.coords.longitude,
        heading: safeHeading(latest.coords.heading),
      });
    } catch (cause) {
      // Best-effort : le premier plan reste la source de réactivité principale une fois
      // l'application rouverte, et le prochain réveil de la tâche retentera de lui-même.
      // Un rejet GPS/géofence est un résultat attendu de la cadence grossière du suivi en
      // arrière-plan (dérive GPS, point resté hors zone) — pas une panne, donc pas de
      // console.error qui déclencherait l'écran rouge de LogBox pour rien.
      const isExpectedRejection = cause instanceof TRPCClientError
        && (cause.message === LIVE_POSITION_GPS_JUMP_ERR_MSG || cause.message === LIVE_POSITION_OUT_OF_ZONE_ERR_MSG);
      if (isExpectedRejection) console.warn("[background-location] point ignoré", cause.message);
      else console.error("[background-location] publication échouée", cause);
    }
  });
}

/**
 * Démarre le suivi en arrière-plan pour une livraison.
 *
 * Demande la permission « toujours » si nécessaire (jamais au lancement : seulement au moment où
 * elle sert réellement, quand une course devient active). Sans elle, la tâche ne fonctionnerait
 * qu'au premier plan — pas d'échec bruyant, juste un suivi qui s'arrête au verrouillage de l'écran
 * comme avant.
 */
export async function startBackgroundDriverTracking(deliveryId: string): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const servicesEnabled = await Location.hasServicesEnabledAsync();
    if (!servicesEnabled) return false;
    const foreground = await Location.getForegroundPermissionsAsync();
    if (!foreground.granted) return false;
    const background = await Location.getBackgroundPermissionsAsync();
    const permission = background.granted ? background : await Location.requestBackgroundPermissionsAsync();
    if (!permission.granted) return false;

    await AsyncStorage.setItem(ACTIVE_DELIVERY_STORAGE_KEY, deliveryId);
    const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_DRIVER_LOCATION_TASK);
    if (alreadyStarted) return true;

    await Location.startLocationUpdatesAsync(BACKGROUND_DRIVER_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      activityType: Location.ActivityType.AutomotiveNavigation,
      timeInterval: 15_000,
      distanceInterval: 50,
      deferredUpdatesInterval: 15_000,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "Course en cours",
        notificationBody: "Tikis partage votre position avec l'expéditeur tant que la course est active.",
        killServiceOnDestroy: true,
      },
    });
    return true;
  } catch (cause) {
    console.error("[background-location] démarrage échoué", cause);
    return false;
  }
}

/** Arrête le suivi en arrière-plan. Idempotent : sans effet si la tâche n'est pas active. */
export async function stopBackgroundDriverTracking(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await AsyncStorage.removeItem(ACTIVE_DELIVERY_STORAGE_KEY);
    const started = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_DRIVER_LOCATION_TASK);
    if (started) await Location.stopLocationUpdatesAsync(BACKGROUND_DRIVER_LOCATION_TASK);
  } catch (cause) {
    console.error("[background-location] arrêt échoué", cause);
  }
}
