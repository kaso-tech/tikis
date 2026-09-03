import { describe, expect, it } from "vitest";
import { determineJustQualified } from "../server/_test-helpers/loyalty-qualification";

describe("déclenchement d'un bonus de fidélité", () => {
  it("déclenche quand completedCount atteint exactement requiredDeliveries", () => {
    expect(determineJustQualified({ completedCount: 50, requiredDeliveries: 50, alreadyGranted: false })).toBe(true);
  });

  it("ne déclenche pas si on est sous le seuil", () => {
    expect(determineJustQualified({ completedCount: 49, requiredDeliveries: 50, alreadyGranted: false })).toBe(false);
  });

  it("ne déclenche pas si on est au-dessus (le bonus se déclenche au passage exact)", () => {
    expect(determineJustQualified({ completedCount: 51, requiredDeliveries: 50, alreadyGranted: false })).toBe(false);
  });

  it("ne déclenche pas si déjà granted (idempotence)", () => {
    expect(determineJustQualified({ completedCount: 50, requiredDeliveries: 50, alreadyGranted: true })).toBe(false);
  });
});
