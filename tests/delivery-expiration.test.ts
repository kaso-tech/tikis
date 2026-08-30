import { describe, expect, it } from "vitest";
import { DELIVERY_EXPIRATION_MS, deliveryExpirationOutcome, isOpenDeliveryExpired } from "../shared/delivery-expiration";

describe("expiration des livraisons ouvertes", () => {
  const now = new Date("2026-08-30T12:00:00.000Z").getTime();

  it("n’expire pas une livraison ouverte avant le délai de 24 heures", () => {
    expect(isOpenDeliveryExpired("open", new Date(now - DELIVERY_EXPIRATION_MS + 1), now)).toBe(false);
  });

  it("expire une livraison ouverte dès 24 heures révolues", () => {
    expect(isOpenDeliveryExpired("open", new Date(now - DELIVERY_EXPIRATION_MS), now)).toBe(true);
  });

  it("expire les livraisons attribuées mais non commencées et finalise celles en cours", () => {
    const oldDate = new Date(now - DELIVERY_EXPIRATION_MS - 1);
    expect(isOpenDeliveryExpired("pending_confirmation", oldDate, now)).toBe(true);
    expect(deliveryExpirationOutcome("active", oldDate, now)).toBe("complete");
  });

  it("ne modifie jamais les livraisons déjà clôturées", () => {
    const oldDate = new Date(now - DELIVERY_EXPIRATION_MS - 1);
    expect(deliveryExpirationOutcome("completed", oldDate, now)).toBeNull();
    expect(deliveryExpirationOutcome("cancelled", oldDate, now)).toBeNull();
    expect(deliveryExpirationOutcome("expired", oldDate, now)).toBeNull();
  });
});
