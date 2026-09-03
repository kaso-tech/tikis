import { describe, expect, it } from "vitest";
import { getLocalDateString, getTodayDateString } from "../server/_test-helpers/date-format";

describe("date-format helpers", () => {
  it("getLocalDateString formate en YYYY-MM-DD", () => {
    expect(getLocalDateString(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(getLocalDateString(new Date(2026, 8, 30))).toBe("2026-09-30");
  });

  it("getLocalDateString pad les jours < 10", () => {
    expect(getLocalDateString(new Date(2026, 0, 1))).toBe("2026-01-01");
    expect(getLocalDateString(new Date(2026, 11, 9))).toBe("2026-12-09");
  });

  it("getLocalDateString accepte la date par défaut (now)", () => {
    const result = getLocalDateString();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("getTodayDateString == getLocalDateString(new Date())", () => {
    const now = new Date();
    expect(getTodayDateString()).toBe(getLocalDateString(now));
  });
});
