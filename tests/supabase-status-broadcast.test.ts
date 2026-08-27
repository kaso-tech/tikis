import { describe, expect, it } from "vitest";
import { publishDeliveryStatusBroadcast } from "../server/supabase-realtime";

describe("diffusion de statut Supabase", () => {
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
