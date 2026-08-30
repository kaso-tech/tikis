import { describe, expect, it } from "vitest";
import { resolveDriverHomeAction } from "../shared/delivery-home-action";

describe("actions livreur de l’accueil", () => {
  it.each([
    [{ status: "open", ownCandidateStatus: undefined }, "apply"],
    [{ status: "open", ownCandidateStatus: "applied" }, "withdraw"],
    [{ status: "pending_confirmation", ownCandidateStatus: "selected" }, "confirm"],
    [{ status: "active", ownCandidateStatus: "confirmed" }, "start"],
  ] as const)("résout %o vers %s", (delivery, action) => {
    expect(resolveDriverHomeAction(delivery)).toBe(action);
  });
});
