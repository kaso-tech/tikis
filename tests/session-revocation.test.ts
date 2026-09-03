import { describe, expect, it } from "vitest";
import { computeSessionExpiry, shouldRevokeOnLogout } from "../server/_test-helpers/session-revocation";

describe("logique de révocation de session", () => {
  it("computeSessionExpiry retourne grantedAt + 30 jours", () => {
    const granted = new Date("2026-09-01T10:00:00.000Z");
    const expected = new Date("2026-10-01T10:00:00.000Z");
    expect(computeSessionExpiry(granted).toISOString()).toBe(expected.toISOString());
  });

  it("shouldRevokeOnLogout retourne true pour la session courante (logout la déconnecte)", () => {
    expect(shouldRevokeOnLogout({ sessionId: "sess-1", isCurrent: true })).toBe(true);
  });

  it("shouldRevokeOnLogout retourne false pour les autres sessions (gérées via /revoke)", () => {
    expect(shouldRevokeOnLogout({ sessionId: "sess-2", isCurrent: false })).toBe(false);
  });
});
