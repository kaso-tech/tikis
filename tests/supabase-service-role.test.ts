import { describe, expect, it } from "vitest";

// Test de déploiement : vérifie que la clé de service Supabase configurée fonctionne
// réellement, pas une propriété du code. Sans les secrets — tout environnement de
// développement ou de CI qui ne les reçoit pas —, il n'y a rien à vérifier ici.
const CONFIGURED = Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());

describe.skipIf(!CONFIGURED)("clé serveur Supabase", () => {
  it("autorise l’accès serveur au point de santé REST sans exposer le secret", async () => {
    const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const response = await fetch(`${url}/rest/v1/`, { headers: { apikey: key!, Authorization: `Bearer ${key!}` } });
    expect([401, 403]).not.toContain(response.status);
  }, 12_000);
});
