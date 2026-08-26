import { describe, expect, it } from "vitest";
import { counterOfferCommission, offeredPriceError, parseOfferedPrice, priceDifferencePercent, sanitizeOfferedPriceInput } from "../lib/delivery-price";

describe("prix proposé de livraison", () => {
  it("supprime les caractères non numériques avant publication", () => {
    expect(sanitizeOfferedPriceInput("4 500 FCFA<script>")).toBe("4500");
  });

  it("valide uniquement un montant dans la plage autorisée", () => {
    expect(parseOfferedPrice("6500")).toBe(6500);
    expect(parseOfferedPrice("99")).toBeUndefined();
    expect(offeredPriceError("99999999")).toContain("10");
  });

  it("calcule l’écart entre prix proposé et estimation", () => {
    expect(priceDifferencePercent(6000, 5000)).toBe(20);
    expect(priceDifferencePercent(4250, 5000)).toBe(-15);
  });

  it("calcule la commission d’une contre-proposition", () => {
    expect(counterOfferCommission(6500, 0.1)).toBe(650);
  });
});
