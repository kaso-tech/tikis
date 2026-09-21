import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pushSource = readFileSync(
  resolve(process.cwd(), "lib/push-notifications.ts"),
  "utf8",
);

describe("contrat Expo Go des notifications push", () => {
  it("ne charge expo-notifications qu’après avoir exclu Expo Go et le web", () => {
    expect(pushSource).not.toMatch(/^import\s+.*from\s+["']expo-notifications["'];?$/m);
    expect(pushSource).toContain('Constants.executionEnvironment === "storeClient"');
    expect(pushSource).toContain('if (Platform.OS === "web" || isExpoGo()) return null;');
    expect(pushSource).toContain('import("expo-notifications")');
  });

  it("utilise un identifiant EAS pour demander un vrai token Expo", () => {
    expect(pushSource).toContain("getExpoPushTokenAsync({ projectId })");
    expect(pushSource).toContain("EXPO_PUBLIC_EAS_PROJECT_ID");
  });

  it("déclare des canaux séparés pour les alertes transactionnelles et les opportunités", () => {
    expect(pushSource).toContain('transactional: "tikis-transactional"');
    expect(pushSource).toContain('opportunities: "tikis-opportunities"');
    expect(pushSource).toContain('tracking: "tikis-delivery-tracking"');
  });
});
