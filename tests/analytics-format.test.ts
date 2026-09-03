import { describe, expect, it } from "vitest";
import { trendBarValue } from "../server/_test-helpers/analytics-format";

describe("calcul du score de barre pour la tendance analytics", () => {
  it("retourne 0 si les max sont 0", () => {
    expect(trendBarValue({ deliveriesCount: 0, totalSpent: 0 }, { deliveriesCount: 0, totalSpent: 0 })).toBe(0);
  });

  it("donne 100 au mois qui domine les deux axes", () => {
    const max = { deliveriesCount: 10, totalSpent: 50000 };
    expect(trendBarValue({ deliveriesCount: 10, totalSpent: 50000 }, max)).toBe(100);
  });

  it("pondère 70% deliveries + 30% montant", () => {
    const max = { deliveriesCount: 10, totalSpent: 10000 };
    // Mois : 5 deliveries (50%) + 10000 (100%) → 0.7*50 + 0.3*100 = 65
    expect(trendBarValue({ deliveriesCount: 5, totalSpent: 10000 }, max)).toBe(65);
  });

  it("arrondit à l'entier", () => {
    const max = { deliveriesCount: 3, totalSpent: 1000 };
    // 1 livraison (33%) + 333 (33%) → 0.7*33.33 + 0.3*33.33 = 33.33 → 33
    expect(trendBarValue({ deliveriesCount: 1, totalSpent: 333 }, max)).toBe(33);
  });
});
