import { describe, expect, it } from "vitest";
import { ACCOUNT_DELETION_GRACE_PERIOD_MS } from "../server/db";

describe("persistance deletionScheduledAt", () => {
  it("la durée de grâce est de 30 jours", () => {
    expect(ACCOUNT_DELETION_GRACE_PERIOD_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("calcule correctement une date de finalisation à partir d'une demande", () => {
    const requestedAt = new Date("2026-09-01T10:00:00.000Z");
    const expected = new Date("2026-10-01T10:00:00.000Z");
    const computed = new Date(requestedAt.getTime() + ACCOUNT_DELETION_GRACE_PERIOD_MS);
    expect(computed.toISOString()).toBe(expected.toISOString());
  });
});
