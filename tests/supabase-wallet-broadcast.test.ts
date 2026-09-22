import { describe, expect, it } from "vitest";
import { publishWalletBroadcast } from "../server/supabase-realtime";

// Test de déploiement : vérifie qu'un vrai signal Realtime part effectivement vers
// Supabase, pas une propriété du code. Sans les secrets qu'utilise
// `publishWalletBroadcast` en interne — tout environnement de développement ou
// de CI qui ne les reçoit pas —, il n'y a rien à vérifier ici.
const CONFIGURED = Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());

describe.skipIf(!CONFIGURED)("diffusion Wallet Supabase", () => {
  it("publie un signal privé de mouvement Wallet avec la clé serveur", async () => {
    const sent = await publishWalletBroadcast("00000000-0000-0000-0000-000000000000");
    expect(sent).toBe(true);
  }, 12_000);
});
