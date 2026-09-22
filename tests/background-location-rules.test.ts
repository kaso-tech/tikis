import { describe, expect, it } from "vitest";
import { safeHeading } from "../lib/background-location-rules";

describe("safeHeading", () => {
  it("laisse passer un cap valide", () => {
    expect(safeHeading(180)).toBe(180);
    expect(safeHeading(0)).toBe(0);
    expect(safeHeading(360)).toBe(360);
  });

  it("retombe sur 0 pour -1, la valeur iOS d'un cap indisponible", () => {
    expect(safeHeading(-1)).toBe(0);
  });

  it("retombe sur 0 pour null, undefined, NaN ou hors bornes", () => {
    expect(safeHeading(null)).toBe(0);
    expect(safeHeading(undefined)).toBe(0);
    expect(safeHeading(NaN)).toBe(0);
    expect(safeHeading(361)).toBe(0);
    expect(safeHeading(-45)).toBe(0);
  });
});
