import { describe, expect, it } from "vitest";
import { publishDeliveryStatusBroadcast } from "../server/supabase-realtime";

// Test de déploiement : vérifie qu'un vrai signal Realtime part effectivement vers
// Supabase, pas une propriété du code. Sans les secrets qu'utilise
// `publishDeliveryStatusBroadcast` en interne — tout environnement de développement ou
// de CI qui ne les reçoit pas —, il n'y a rien à vérifier ici.
const CONFIGURED = Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());

describe.skipIf(!CONFIGURED)("diffusion de statut Supabase", () => {
  it("publie un signal privé de statut avec la clé serveur", async () => {
    const sent = await publishDeliveryStatusBroadcast({
      deliveryId: "status_test_20260827",
      status: "active",
      title: "Livraison activée",
      body: "Événement de validation sécurisé.",
      occurredAt: new Date().toISOString(),
    });
    expect(sent).toBe(true);
  }, 12_000);
});
