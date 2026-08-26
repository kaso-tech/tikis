import { describe, expect, it } from "vitest";

describe("jeton Supabase Management API", () => {
  it("accède au projet configuré sans exposer le jeton", async () => {
    const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    expect(url, "EXPO_PUBLIC_SUPABASE_URL doit être configurée").toBeTruthy();
    expect(token, "SUPABASE_ACCESS_TOKEN doit être configuré").toBeTruthy();
    const projectRef = new URL(url!).hostname.split(".")[0];
    const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.ok, "Le jeton Supabase doit accéder au projet configuré").toBe(true);
  }, 20_000);
});
