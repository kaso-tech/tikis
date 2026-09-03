import { describe, expect, it } from "vitest";
import { trendBarValue } from "../server/_test-helpers/analytics-format";

describe("KPI sender home (helpers partagés)", () => {
  it("trendBarValue est 0 si tout est à 0", () => {
    expect(trendBarValue({ deliveriesCount: 0, totalSpent: 0 }, { deliveriesCount: 0, totalSpent: 0 })).toBe(0);
  });

  it("trendBarValue = 100 quand le mois domine les deux axes", () => {
    expect(trendBarValue({ deliveriesCount: 10, totalSpent: 50000 }, { deliveriesCount: 10, totalSpent: 50000 })).toBe(100);
  });

  it("trendBarValue pondère 70% deliveries + 30% montant", () => {
    const max = { deliveriesCount: 10, totalSpent: 10000 };
    expect(trendBarValue({ deliveriesCount: 5, totalSpent: 10000 }, max)).toBe(65);
  });
});
