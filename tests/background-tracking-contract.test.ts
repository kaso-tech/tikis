import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const config = read("app.config.ts");
const packageJson = read("package.json");
const task = read("lib/background-location-task.ts");
const provider = read("components/tikis/delivery-realtime-provider.tsx");
const layout = read("app/_layout.tsx");

describe("le suivi de position du livreur survit à l'arrière-plan", () => {
  it("expo-task-manager est une dépendance, pas seulement expo-location", () => {
    expect(packageJson).toContain('"expo-task-manager"');
  });

  it("app.config.ts active le mode arrière-plan sur les deux plateformes", () => {
    expect(config).toContain("isIosBackgroundLocationEnabled: true");
    expect(config).toContain("isAndroidBackgroundLocationEnabled: true");
    expect(config).toContain("isAndroidForegroundServiceEnabled: true");
    expect(config).toContain("locationAlwaysAndWhenInUsePermission:");
    expect(config).toContain('"expo-task-manager"');
  });

  it("defineTask est appelé au chargement du module, pas dans un composant", () => {
    // TaskManager exige que la tâche soit déclarée tôt, en dehors de tout arbre React —
    // sinon l'OS ne la retrouve jamais au réveil.
    expect(task).toMatch(/^\s*TaskManager\.defineTask/m);
    expect(layout).toContain('import "@/lib/background-location-task"');
  });

  it("ne touche jamais aux API de suivi là où elles n'existent pas : web et Expo Go", () => {
    // Le web n'a aucune API TaskManager. Expo Go tourne sur un binaire natif qui n'est pas le
    // nôtre : expo-location y répond par un avertissement, affiché en rouge dans LogBox dès le
    // premier écran, puisque `stopBackgroundDriverTracking` part dès qu'aucune course n'est active.
    // `isRunningInExpoGo` (celui de `expo`, qu'interroge expo-location lui-même) et non
    // `Constants.executionEnvironment`, qui range Expo Go et les development builds sous la même
    // valeur : s'y fier couperait le suivi précisément là où il fonctionne.
    expect(task).toContain('Platform.OS !== "web" && !isRunningInExpoGo()');
    expect(task).toContain('from "expo"');
    expect(task).toContain("if (!BACKGROUND_TRACKING_SUPPORTED) return false;");
    expect(task).toContain("if (!BACKGROUND_TRACKING_SUPPORTED) return;");
    // La tâche elle-même n'est déclarée que là où l'OS saura la réveiller.
    expect(task).toMatch(/if \(BACKGROUND_TRACKING_SUPPORTED\) \{\n\s*TaskManager\.defineTask/);
  });

  it("un cap invalide ne fait jamais échouer la publication de la position", () => {
    expect(task).toContain("safeHeading(latest.coords.heading)");
  });

  it("la livraison suivie est persistée, jamais lue depuis l'état d'un composant", () => {
    // La tâche s'exécute hors de tout arbre React : elle ne peut lire ni `selected`
    // (home-screen.native.tsx) ni aucun state — seul AsyncStorage traverse ce réveil.
    expect(task).toContain("AsyncStorage.setItem(ACTIVE_DELIVERY_STORAGE_KEY");
    expect(task).toContain("AsyncStorage.getItem(ACTIVE_DELIVERY_STORAGE_KEY)");
  });

  it("la permission « toujours » n'est demandée qu'au moment où une course devient active", () => {
    // Jamais au lancement : getBackgroundPermissionsAsync() est vérifié avant de la redemander.
    expect(task).toContain("getBackgroundPermissionsAsync()");
    expect(task).toContain("requestBackgroundPermissionsAsync()");
  });

  it("le fournisseur démarre et arrête le suivi selon la vraie course active du livreur, pas la sélection d'écran", () => {
    expect(provider).toContain('delivery.status === "active" && delivery.driverId === profile?.phone');
    expect(provider).toContain("startBackgroundDriverTracking(activeDriverDeliveryId)");
    expect(provider).toContain("stopBackgroundDriverTracking()");
  });

  it("l'effet ne s'arrête jamais à son propre démontage : le suivi doit survivre à la disparition de l'arbre React", () => {
    const effect = provider.slice(provider.indexOf("useEffect(() => {\n    // Ne s'arrête jamais"));
    const cleanupSlice = effect.slice(0, effect.indexOf("}, [activeDriverDeliveryId]);"));
    expect(cleanupSlice).not.toMatch(/return \(\) => \{[^}]*stopBackgroundDriverTracking/);
  });

  it("le client tRPC de la tâche reste isolé : un seul appel, jamais groupé", () => {
    expect(task).toContain("httpLink({");
    expect(task).not.toContain("httpBatchLink");
  });

  it("un rejet GPS/géofence attendu ne journalise jamais en console.error (écran rouge LogBox pour rien)", () => {
    const routers = read("server/routers.ts");
    const constants = read("shared/const.ts");
    // Les deux messages viennent d'une seule source partagée : server/routers.ts (qui les lève)
    // et lib/background-location-task.ts (qui les compare) ne peuvent pas diverger silencieusement.
    expect(constants).toContain("LIVE_POSITION_GPS_JUMP_ERR_MSG");
    expect(constants).toContain("LIVE_POSITION_OUT_OF_ZONE_ERR_MSG");
    expect(routers).toContain("throw new Error(LIVE_POSITION_GPS_JUMP_ERR_MSG)");
    expect(routers).toContain("throw new Error(LIVE_POSITION_OUT_OF_ZONE_ERR_MSG)");
    expect(task).toContain("cause instanceof TRPCClientError");
    expect(task).toContain("cause.message === LIVE_POSITION_GPS_JUMP_ERR_MSG || cause.message === LIVE_POSITION_OUT_OF_ZONE_ERR_MSG");
    expect(task).toContain('console.warn("[background-location] point ignoré"');
  });
});
