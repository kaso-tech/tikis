import { describe, expect, it } from "vitest";
import { canApplyToDelivery, deliveryTextInputIssue, isAllowedDeliveryText, sanitizeDeliveryText } from "../lib/tikis-engine";
import { availableWalletBalance, commissionFor } from "../shared/tikis-domain";

describe("règles métier Tikis de démonstration", () => {
  const policy = { rate: 0.1, currency: "FCFA" as const };

  it("calcule la commission selon le taux configurable et le solde disponible", () => {
    expect(commissionFor(8500, policy)).toBe(850);
    expect(availableWalletBalance({ total: 45000, blocked: 1200 })).toBe(43800);
    expect(canApplyToDelivery({ total: 1000, blocked: 200 }, 4500, policy)).toBe(true);
    expect(canApplyToDelivery({ total: 400, blocked: 0 }, 4500, policy)).toBe(false);
  });

  it("assainit les caractères dangereux et accepte une saisie réaliste", () => {
    expect(isAllowedDeliveryText("Maison de l'Entreprise - Ouaga 2000")).toBe(true);
    expect(isAllowedDeliveryText("<script>alert(1)</script>")).toBe(false);
    expect(sanitizeDeliveryText("  Colis   urgent <test> ")).toBe("Colis urgent test");
  });

  it("préserve un espace simple pendant la saisie puis nettoie la valeur finale", () => {
    expect(sanitizeDeliveryText("Documents ", { preserveTrailingSpace: true })).toBe("Documents ");
    expect(sanitizeDeliveryText("Documents   confidentiels ", { preserveTrailingSpace: true })).toBe("Documents confidentiels ");
    expect(sanitizeDeliveryText("Documents   confidentiels ")).toBe("Documents confidentiels");
    expect(sanitizeDeliveryText("Consignes <script> importantes", { preserveTrailingSpace: true })).toBe("Consignes script importantes");
  });

  it("signale les caractères refusés et les champs requis vides sans empêcher les espaces simples", () => {
    expect(deliveryTextInputIssue("Documents de bureau")).toBe("");
    expect(deliveryTextInputIssue("Documents <script>")).toBe("Caractères non autorisés.");
    expect(deliveryTextInputIssue("   ")).toBe("Ce champ est requis.");
  });
});
