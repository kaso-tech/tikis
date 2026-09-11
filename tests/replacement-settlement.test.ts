import { describe, expect, it } from "vitest";
import { computeReplacementSettlement } from "../shared/wallet-commission";

describe("computeReplacementSettlement", () => {
  it("ne fait rien s'il n'y a pas de livreur précédent (première sélection)", () => {
    expect(computeReplacementSettlement(null, 1_000)).toEqual({ kind: "none" });
  });

  it("libère simplement la commission d'un candidat 'selected' (jamais confirmé, jamais débité)", () => {
    const settlement = computeReplacementSettlement({ status: "selected", commissionBlocked: 1_000 }, 1_500);
    expect(settlement).toEqual({ kind: "release", amount: 1_000 });
  });

  it("ne dépend jamais de la nouvelle commission pour un candidat 'selected' — c'est la régression du bug de double crédit", () => {
    // Avant le correctif, ce cas traitait `commissionBlocked` de l'ancien candidat comme une
    // "compensation" (un crédit disponible en plus, sans jamais retirer le montant du solde bloqué) :
    // le livreur remplacé se retrouvait avec le double de sa commission. Un candidat "selected" ne
    // doit produire qu'un déblocage, quel que soit le montant de la nouvelle commission.
    const low = computeReplacementSettlement({ status: "selected", commissionBlocked: 1_000 }, 200);
    const high = computeReplacementSettlement({ status: "selected", commissionBlocked: 1_000 }, 5_000);
    expect(low).toEqual({ kind: "release", amount: 1_000 });
    expect(high).toEqual({ kind: "release", amount: 1_000 });
  });

  it("rembourse intégralement un candidat 'confirmed' quand la nouvelle commission suffit à couvrir l'ancienne", () => {
    const settlement = computeReplacementSettlement({ status: "confirmed", commissionBlocked: 1_000 }, 1_000);
    expect(settlement).toEqual({ kind: "compensate", amountOwedToPriorDriver: 1_000, coveredByNewCommission: 1_000, platformTopUp: 0, platformSurplus: 0 });
  });

  it("complète par la plateforme quand la nouvelle commission ne suffit pas à couvrir l'ancienne", () => {
    const settlement = computeReplacementSettlement({ status: "confirmed", commissionBlocked: 1_000 }, 600);
    expect(settlement).toEqual({ kind: "compensate", amountOwedToPriorDriver: 1_000, coveredByNewCommission: 600, platformTopUp: 400, platformSurplus: 0 });
  });

  it("conserve le surplus pour la plateforme quand la nouvelle commission dépasse l'ancienne, sans jamais percevoir une deuxième commission complète", () => {
    const settlement = computeReplacementSettlement({ status: "confirmed", commissionBlocked: 1_000 }, 1_500);
    expect(settlement).toEqual({ kind: "compensate", amountOwedToPriorDriver: 1_000, coveredByNewCommission: 1_000, platformTopUp: 0, platformSurplus: 500 });
    // Le livreur remplacé ne récupère jamais plus que ce qui lui a été réellement prélevé.
    expect(settlement.kind === "compensate" ? settlement.amountOwedToPriorDriver : null).toBe(1_000);
  });
});
