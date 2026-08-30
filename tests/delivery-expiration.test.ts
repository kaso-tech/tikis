import { describe, expect, it } from "vitest";
import { DELIVERY_EXPIRATION_MS, isOpenDeliveryExpired } from "../shared/delivery-expiration";

describe("expiration des livraisons ouvertes", () => {
  const now = new Date("2026-08-30T12:00:00.000Z").getTime();

  it("n’expire pas une livraison ouverte avant le délai de 24 heures", () => {
    expect(isOpenDeliveryExpired("open", new Date(now - DELIVERY_EXPIRATION_MS + 1), now)).toBe(false);
  });

  it("expire une livraison ouverte dès 24 heures révolues", () => {
    expect(isOpenDeliveryExpired("open", new Date(now - DELIVERY_EXPIRATION_MS), now)).toBe(true);
  });

  it("n’expire jamais une livraison déjà attribuée ou en transit", () => {
    const oldDate = new Date(now - DELIVERY_EXPIRATION_MS - 1);
    expect(isOpenDeliveryExpired("pending_confirmation", oldDate, now)).toBe(false);
    expect(isOpenDeliveryExpired("active", oldDate, now)).toBe(false);
  });
});
