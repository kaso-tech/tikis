import { describe, expect, it } from "vitest";
import { computeProgressPercent, formatRemainingMessage } from "../server/_test-helpers/loyalty-progress-format";

describe("format du programme de fidélité (UI mobile)", () => {
  it("computeProgressPercent arrondit à l'entier", () => {
    expect(computeProgressPercent(25, 50)).toBe(50);
    expect(computeProgressPercent(33, 50)).toBe(66);
    expect(computeProgressPercent(50, 50)).toBe(100);
  });

  it("computeProgressPercent clamp à 100", () => {
    expect(computeProgressPercent(75, 50)).toBe(100);
  });

  it("computeProgressPercent gère le seuil 0", () => {
    expect(computeProgressPercent(0, 0)).toBe(100);
  });

  it("formatRemainingMessage affiche le compteur restant si non atteint", () => {
    expect(formatRemainingMessage({ remaining: 5, alreadyGranted: false, bonusAmount: 5000 })).toContain("Plus que 5 courses");
    expect(formatRemainingMessage({ remaining: 5, alreadyGranted: false, bonusAmount: 5000 })).toMatch(/5[\s\u202f]000/);
  });

  it("formatRemainingMessage singulier/pluriel correct", () => {
    expect(formatRemainingMessage({ remaining: 1, alreadyGranted: false, bonusAmount: 5000 })).toContain("Plus que 1 course");
    expect(formatRemainingMessage({ remaining: 2, alreadyGranted: false, bonusAmount: 5000 })).toContain("Plus que 2 courses");
  });

  it("formatRemainingMessage affiche 'en attente de validation' si alreadyGranted", () => {
    expect(formatRemainingMessage({ remaining: 0, alreadyGranted: true, bonusAmount: 5000 })).toContain("attente de validation");
  });

  it("formatRemainingMessage affiche 'Palier atteint !' si pas encore granted", () => {
    expect(formatRemainingMessage({ remaining: 0, alreadyGranted: false, bonusAmount: 5000 })).toContain("Palier atteint");
  });
});
