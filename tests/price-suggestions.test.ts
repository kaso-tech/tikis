import { describe, expect, it } from "vitest";
import { priceSuggestions, priceSuggestionStep } from "../lib/price-suggestions";

describe("raccourcis de prix", () => {
  it("propose l'estimation puis deux majorations arrondies au demi-millier", () => {
    expect(priceSuggestions(3_000)).toEqual([
      { amount: 3_000, markupPercent: 0 },
      { amount: 3_500, markupPercent: 17 },
      { amount: 4_000, markupPercent: 33 },
    ]);
  });

  it("arrondit à la centaine sur les petites courses, où le demi-millier doublerait la mise", () => {
    expect(priceSuggestionStep(800)).toBe(100);
    expect(priceSuggestions(800).map((item) => item.amount)).toEqual([800, 1_000, 1_100]);
  });

  it("n'arrondit jamais vers le bas : une suggestion ne descend pas sous l'estimation", () => {
    for (let estimate = 300; estimate <= 40_000; estimate += 137) {
      const [first, ...markups] = priceSuggestions(estimate);
      expect(first.amount).toBe(Math.round(estimate));
      for (const markup of markups) expect(markup.amount).toBeGreaterThan(estimate);
    }
  });

  it("rend des montants strictement croissants, sans doublon dû à l'arrondi", () => {
    for (let estimate = 100; estimate <= 20_000; estimate += 53) {
      const amounts = priceSuggestions(estimate).map((item) => item.amount);
      for (let i = 1; i < amounts.length; i += 1) expect(amounts[i]).toBeGreaterThan(amounts[i - 1]);
    }
  });

  it("ne propose rien tant qu'il n'y a pas d'estimation", () => {
    expect(priceSuggestions(0)).toEqual([]);
    expect(priceSuggestions(Number.NaN)).toEqual([]);
    expect(priceSuggestions(-500)).toEqual([]);
  });
});
