import { describe, expect, it } from "vitest";
import { candidateMovementVersion } from "../shared/wallet-commission";

describe("version des mouvements de commission", () => {
  it("génère une nouvelle clé après chaque cycle de candidature", () => {
    const first = candidateMovementVersion({ status: "withdrawn", updatedAt: new Date("2026-08-30T10:00:00.000Z") });
    const second = candidateMovementVersion({ status: "withdrawn", updatedAt: new Date("2026-08-30T10:05:00.000Z") });
    expect(first).not.toBe(second);
  });
});
