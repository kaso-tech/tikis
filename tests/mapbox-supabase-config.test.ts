import { describe, expect, it } from "vitest";

const requiredVariables = [
  "EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN",
  "MAPBOX_SECRET_ACCESS_TOKEN",
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

describe("configuration Mapbox et Supabase", () => {
  it("expose tous les paramètres requis sans les journaliser", () => {
    for (const key of requiredVariables) {
      expect(process.env[key]?.trim(), `${key} doit être configuré`).toBeTruthy();
    }
  });

  it("utilise une URL Supabase HTTPS", () => {
    expect(process.env.EXPO_PUBLIC_SUPABASE_URL).toMatch(/^https:\/\/.+/);
  });
});
