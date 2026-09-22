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

  it("la tâche ne s'exécute jamais sur web (aucune API TaskManager n'y existe)", () => {
    expect(task).toContain('Platform.OS !== "web"');
    expect(task).toContain('if (Platform.OS === "web") return');
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
});
