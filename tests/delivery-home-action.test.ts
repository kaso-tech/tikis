import { describe, expect, it } from "vitest";
import { resolveDriverHomeAction, resolveSenderHomeAction, senderHomeActionLabel } from "../shared/delivery-home-action";

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

/**
 * Le libellé du bouton et l'action qu'il déclenche étaient écrits séparément
 * dans chaque écran d'accueil. Un statut couvert par l'un et pas par l'autre
 * donnait un bouton visible qui ne faisait rien — le symptôme signalé sur
 * « Candidats ». Ces tests verrouillent l'invariant : tout libellé affiché
 * correspond à une action, et aucune livraison n'aboutit à une action absente.
 */
describe("actions expéditeur de l’accueil", () => {
  it.each([
    [{ status: "open", candidateCount: 2 }, "candidates", "Candidats"],
    [{ status: "open", candidateCount: 0 }, "cancel", "Annuler"],
    [{ status: "active", candidateCount: 1 }, "track", "Suivre"],
    [{ status: "pending_confirmation", candidateCount: 1 }, "track", "Suivre"],
    [{ status: "completed", candidateCount: 1, driverPhone: "+22670000000" }, "rate", "Noter"],
  ] as const)("résout %o vers %s", (delivery, action, label) => {
    expect(resolveSenderHomeAction(delivery)).toBe(action);
    expect(senderHomeActionLabel(action)).toBe(label);
  });

  it("annule une course publiée dont le compteur de candidatures est absent", () => {
    // `candidateCount` manquant ne doit pas tomber entre deux branches : c'était
    // exactement le cas où le bouton restait sans effet.
    expect(resolveSenderHomeAction({ status: "open" })).toBe("cancel");
  });

  it("retombe sur la fiche livraison pour tout autre statut, jamais sur rien", () => {
    for (const status of ["draft", "disabled", "cancelled", "expired"] as const) {
      expect(resolveSenderHomeAction({ status })).toBe("details");
    }
    expect(resolveSenderHomeAction({ status: "completed" })).toBe("details");
    expect(senderHomeActionLabel("details")).toBeNull();
  });
});
