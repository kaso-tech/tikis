import { describe, expect, it } from "vitest";
import { aggregateBonusAmount, filterEntriesByFlow } from "../server/_test-helpers/flow-bonus-aggregation";

describe("agrégation bonus / gains (earnings page)", () => {
  it("filterEntriesByFlow ne garde que les earnings par défaut", () => {
    const entries = [
      { id: "1", amount: 1000, operation: "compensation" as const, createdAt: "2026-01-01T00:00:00Z" },
      { id: "2", amount: 500, operation: "bonus" as const, createdAt: "2026-01-02T00:00:00Z" },
    ];
    expect(filterEntriesByFlow(entries, "earnings").map((e) => e.id)).toEqual(["1"]);
  });

  it("filterEntriesByFlow ne garde que les bonus en mode bonus", () => {
    const entries = [
      { id: "1", amount: 1000, operation: "compensation" as const, createdAt: "2026-01-01T00:00:00Z" },
      { id: "2", amount: 500, operation: "bonus" as const, createdAt: "2026-01-02T00:00:00Z" },
    ];
    expect(filterEntriesByFlow(entries, "bonus").map((e) => e.id)).toEqual(["2"]);
  });

  it("filterEntriesByFlow en mode all retourne tout", () => {
    const entries = [
      { id: "1", amount: 1000, operation: "compensation" as const, createdAt: "2026-01-01T00:00:00Z" },
      { id: "2", amount: 500, operation: "bonus" as const, createdAt: "2026-01-02T00:00:00Z" },
    ];
    expect(filterEntriesByFlow(entries, "all")).toHaveLength(2);
  });

  it("aggregateBonusAmount fait la somme correctement", () => {
    expect(aggregateBonusAmount([])).toBe(0);
    expect(
      aggregateBonusAmount([
        { amount: 100, operation: "bonus" },
        { amount: 250, operation: "bonus" },
        { amount: 50, operation: "compensation" },
      ] as any),
    ).toBe(350);
  });
});
