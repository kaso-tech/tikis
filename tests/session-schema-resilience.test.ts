import { describe, expect, it } from "vitest";
import { isMissingProfileSessionsSchema } from "../server/sessions";

describe("résilience du schéma de sessions", () => {
  it("identifie une table de sessions absente dans une erreur MySQL", () => {
    expect(isMissingProfileSessionsSchema({ cause: { code: "ER_NO_SUCH_TABLE", message: "Table 'db.tikis_profile_sessions' doesn't exist" } })).toBe(true);
  });

  it("ne masque pas les erreurs de base non liées au schéma de sessions", () => {
    expect(isMissingProfileSessionsSchema({ cause: { code: "ER_ACCESS_DENIED_ERROR", message: "Access denied" } })).toBe(false);
  });
});
