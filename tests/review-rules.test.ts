import { describe, expect, it } from "vitest";
import { canSubmitDeliveryReview, isValidReviewText, sanitizeReviewText } from "../lib/review-rules";

describe("règles d’avis Tikis", () => {
  it("autorise une notation uniquement après une livraison terminée et une seule fois", () => {
    expect(canSubmitDeliveryReview("completed", false, 5)).toBe(true);
    expect(canSubmitDeliveryReview("active", false, 5)).toBe(false);
    expect(canSubmitDeliveryReview("completed", true, 5)).toBe(false);
    expect(canSubmitDeliveryReview("completed", false, 6)).toBe(false);
  });

  it("bloque les caractères dangereux et assainit les commentaires", () => {
    expect(isValidReviewText("Prestation très soignée, merci.")).toBe(true);
    expect(isValidReviewText("<script>alert(1)</script>")).toBe(false);
    expect(sanitizeReviewText("  Très   bonne   prestation < > ")).toBe("Très bonne prestation");
  });
});
