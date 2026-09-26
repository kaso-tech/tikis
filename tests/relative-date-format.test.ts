import { describe, expect, it } from "vitest";

import { formatRelativeDate } from "../shared/tikis-domain";

describe("formatRelativeDate", () => {
  const now = new Date("2026-09-26T18:00:00.000Z").getTime();

  it("utilise les libellés compacts pour secondes, minutes et heures", () => {
    expect(formatRelativeDate(new Date(now - 12_000).toISOString(), now)).toBe("il y a 12 sec");
    expect(formatRelativeDate(new Date(now - 7 * 60_000).toISOString(), now)).toBe("il y a 7 min");
    expect(formatRelativeDate(new Date(now - 21 * 3_600_000).toISOString(), now)).toBe("il y a 21h");
  });

  it("n’affiche jamais le suffixe heure(s)", () => {
    expect(formatRelativeDate(new Date(now - 3_600_000).toISOString(), now)).not.toContain("heure(s)");
  });
});
