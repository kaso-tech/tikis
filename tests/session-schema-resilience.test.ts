import { describe, expect, it } from "vitest";
import { isMissingProfileSessionsSchema } from "../server/sessions";

describe("résilience du schéma de sessions", () => {
  it("identifie une table de sessions absente dans une erreur PostgreSQL", () => {
    expect(isMissingProfileSessionsSchema({ cause: { code: "42P01", message: 'relation "tikisse_profile_sessions" does not exist' } })).toBe(true);
  });

  it("ne confond pas avec l'absence d'une autre table", () => {
    expect(isMissingProfileSessionsSchema({ cause: { code: "42P01", message: 'relation "tikisse_wallets" does not exist' } })).toBe(false);
  });

  it("ne masque pas les erreurs de base non liées au schéma de sessions", () => {
    expect(isMissingProfileSessionsSchema({ cause: { code: "28P01", message: "password authentication failed" } })).toBe(false);
  });
});
