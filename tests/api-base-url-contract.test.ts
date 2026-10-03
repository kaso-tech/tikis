import { describe, expect, it } from "vitest";
import { resolveApiBaseUrl, TIKISSE_PRODUCTION_API_URL } from "../constants/api-base-url";

describe("résolution de l’API Tikisse", () => {
  it("privilégie l’URL fournie au build", () => {
    expect(resolveApiBaseUrl("https://preview.example.test/", "android")).toBe("https://preview.example.test");
  });

  it("conserve l’API locale uniquement pour Expo Web sur Metro", () => {
    expect(resolveApiBaseUrl(undefined, "web", { protocol: "http:", hostname: "localhost", port: "8081" })).toBe("http://localhost:3000");
  });

  it.each(["android", "ios", "web"] as const)("utilise Render quand Expo Go ne reçoit pas de variable (%s)", (platform) => {
    const location = platform === "web" ? { protocol: "https:", hostname: "app.tikisse.com", port: "" } : undefined;
    expect(resolveApiBaseUrl(undefined, platform, location)).toBe(TIKISSE_PRODUCTION_API_URL);
  });
});
