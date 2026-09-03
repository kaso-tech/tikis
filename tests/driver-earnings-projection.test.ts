import { describe, expect, it } from "vitest";
import { computeProjection30Days, computeTrendPct, formatTopDayDate } from "../server/_test-helpers/driver-earnings-projection";

describe("projection gains driver (helpers purs)", () => {
  it("computeProjection30Days multiplie la moyenne par 30", () => {
    expect(computeProjection30Days(21000)).toBe(90000);
    expect(computeProjection30Days(0)).toBe(0);
    expect(computeProjection30Days(1000)).toBe(30000);
  });

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
