import { describe, expect, it } from "vitest";
import { canReviewDelivery } from "../server/_test-helpers/review-eligibility";

describe("éligibilité à la notation d'une livraison", () => {
  it("autorise un sender à noter une livraison completed avec un driver assigné", () => {
    expect(canReviewDelivery({ status: "completed", senderPhone: "+237699000001", driverPhone: "+237699000002" }, "+237699000001", "sender", true)).toBe(true);
  });

  it("refuse si la livraison n'est pas completed", () => {
    expect(canReviewDelivery({ status: "active", senderPhone: "+237699000001", driverPhone: "+237699000002" }, "+237699000001", "sender", true)).toBe(false);
    expect(canReviewDelivery({ status: "expired", senderPhone: "+237699000001", driverPhone: "+237699000002" }, "+237699000001", "sender", true)).toBe(false);
    expect(canReviewDelivery({ status: "cancelled", senderPhone: "+237699000001", driverPhone: "+237699000002" }, "+237699000001", "sender", true)).toBe(false);
  });

  it("refuse si le viewer n'est pas le sender", () => {
    expect(canReviewDelivery({ status: "completed", senderPhone: "+237699000001", driverPhone: "+237699000002" }, "+237699000099", "sender", true)).toBe(false);
  });

  it("refuse si le viewer est un driver", () => {
    expect(canReviewDelivery({ status: "completed", senderPhone: "+237699000001", driverPhone: "+237699000002" }, "+237699000002", "driver", true)).toBe(false);
  });

  it("refuse si la livraison n'a pas de driver", () => {
    expect(canReviewDelivery({ status: "completed", senderPhone: "+237699000001", driverPhone: null }, "+237699000001", "sender", true)).toBe(false);
  });

  it("refuse si un avis existe déjà", () => {
    expect(canReviewDelivery({ status: "completed", senderPhone: "+237699000001", driverPhone: "+237699000002" }, "+237699000001", "sender", false)).toBe(false);
  });
});
