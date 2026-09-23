import { describe, expect, it } from "vitest";
import { computeTrendPct, formatTopDayDate } from "../server/_test-helpers/driver-earnings-projection";

describe("projection gains driver (helpers purs)", () => {
  it("computeTrendPct retourne le pourcentage d'évolution", () => {
    expect(computeTrendPct(14000, 7000)).toBe(100); // +100%
    expect(computeTrendPct(7000, 14000)).toBe(-50); // -50%
    expect(computeTrendPct(0, 0)).toBeNull();
    expect(computeTrendPct(1000, 0)).toBeNull();
  });

  it("formatTopDayDate formate YYYY-MM-DD en 'DD MMM.'", () => {
    expect(formatTopDayDate("2026-09-03")).toBe("3 sept.");
    expect(formatTopDayDate("2026-12-25")).toBe("25 déc.");
    expect(formatTopDayDate("invalid")).toBe("invalid");
  });
});
