import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pushRegistrationSource = readFileSync(
  resolve(process.cwd(), "hooks/use-push-registration.ts"),
  "utf8",
);

describe("contrat Expo Go des notifications push", () => {
  it("ne charge expo-notifications qu’après avoir exclu Expo Go", () => {
    expect(pushRegistrationSource).not.toMatch(/^import\s+.*from\s+["']expo-notifications["'];?$/m);
    expect(pushRegistrationSource).toContain('Constants.executionEnvironment === "storeClient"');
    expect(pushRegistrationSource).toContain('return await import("expo-notifications")');
  });
});
