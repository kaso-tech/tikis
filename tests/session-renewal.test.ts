import { describe, expect, it } from "vitest";
import { shouldRenewSession, TIKISSE_SESSION_RENEW_AFTER_SECONDS, TIKISSE_SESSION_TTL_SECONDS } from "../server/tikisse-session";

describe("renouvellement des sessions", () => {
  const now = 2_000_000_000;

  it("ne renouvelle pas un jeton de moins d'une semaine", () => {
    expect(shouldRenewSession(now - 3600, now)).toBe(false);
    expect(shouldRenewSession(now - TIKISSE_SESSION_RENEW_AFTER_SECONDS + 1, now)).toBe(false);
  });

  it("renouvelle au-delà d'une semaine, bien avant l'échéance d'un an", () => {
    expect(shouldRenewSession(now - TIKISSE_SESSION_RENEW_AFTER_SECONDS, now)).toBe(true);
    expect(TIKISSE_SESSION_RENEW_AFTER_SECONDS).toBeLessThan(TIKISSE_SESSION_TTL_SECONDS / 10);
  });
});
