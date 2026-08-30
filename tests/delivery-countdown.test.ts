import { describe, expect, it } from "vitest";
import { deliveryRemainingMs, formatDeliveryCountdown } from "../lib/delivery-countdown";
import { DELIVERY_EXPIRATION_MS } from "../shared/delivery-expiration";

describe("compte à rebours de livraison", () => {
  const now = new Date("2026-08-30T12:00:00.000Z").getTime();

  it("calcule le temps restant jusqu’à l’échéance des vingt-quatre heures", () => {
    expect(deliveryRemainingMs(new Date(now - DELIVERY_EXPIRATION_MS + 3_661_000), now)).toBe(3_661_000);
    expect(formatDeliveryCountdown(3_661_000)).toBe("1 h 01 min 01 s");
  });

  it("ne retourne jamais un délai négatif et protège les dates invalides", () => {
    expect(deliveryRemainingMs(new Date(now - DELIVERY_EXPIRATION_MS - 1), now)).toBe(0);
    expect(deliveryRemainingMs("invalide", now)).toBeNull();
    expect(formatDeliveryCountdown(0)).toBe("Échéance atteinte");
  });
});
