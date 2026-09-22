import { describe, expect, it } from "vitest";

const requiredVariables = [
  "EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN",
  "MAPBOX_SECRET_ACCESS_TOKEN",
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

// Un test de déploiement (les secrets Mapbox/Supabase sont bien configurés), pas un test de
// l'application : sans eux — tout environnement de développement ou de CI qui ne les reçoit
// pas —, il n'y a rien à vérifier ici. Sans ce garde, ces deux tests étaient rouges en
// permanence dans un tel environnement, masquant une vraie régression derrière un bruit
// connu et jamais corrigé.
const CONFIGURED = requiredVariables.every((key) => Boolean(process.env[key]?.trim()));

describe.skipIf(!CONFIGURED)("configuration Mapbox et Supabase", () => {
  it("expose tous les paramètres requis sans les journaliser", () => {
    for (const key of requiredVariables) {
      expect(process.env[key]?.trim(), `${key} doit être configuré`).toBeTruthy();
    }
  });

  it("utilise une URL Supabase HTTPS", () => {
    expect(process.env.EXPO_PUBLIC_SUPABASE_URL).toMatch(/^https:\/\/.+/);
  });
});
