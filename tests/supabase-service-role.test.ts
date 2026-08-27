import { describe, expect, it } from "vitest";

describe("clé serveur Supabase", () => {
  it("autorise l’accès serveur au point de santé REST sans exposer le secret", async () => {
    const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(url).toBeTruthy();
    expect(key).toBeTruthy();
    const response = await fetch(`${url}/rest/v1/`, { headers: { apikey: key!, Authorization: `Bearer ${key!}` } });
    expect([401, 403]).not.toContain(response.status);
  }, 12_000);
});
