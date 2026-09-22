import { describe, expect, it } from "vitest";

// Test de déploiement : vérifie que le jeton Supabase Management API configuré accède
// réellement au projet, pas une propriété du code. Sans les secrets — tout environnement
// de développement ou de CI qui ne les reçoit pas —, il n'y a rien à vérifier ici.
const CONFIGURED = Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() && process.env.SUPABASE_ACCESS_TOKEN?.trim());

describe.skipIf(!CONFIGURED)("jeton Supabase Management API", () => {
  it("accède au projet configuré sans exposer le jeton", async () => {
    const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    const projectRef = new URL(url!).hostname.split(".")[0];
    const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.ok, "Le jeton Supabase doit accéder au projet configuré").toBe(true);
  }, 20_000);
});
