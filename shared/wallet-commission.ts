export function candidateMovementVersion(candidate?: { status: string; updatedAt: Date }): string {
  return candidate ? `${candidate.status}:${candidate.updatedAt.getTime()}` : "initial";
}

/** Décision financière lors du remplacement d'un livreur par un autre.
 *
 * - `"none"` : pas de livreur précédent (première sélection).
 * - `"release"` : le précédent candidat était seulement `"selected"` (jamais confirmé, donc jamais
 *   débité) — sa commission encore intégralement dans `heldBalance` doit simplement être débloquée.
 *   Le traiter comme une compensation créditerait deux fois le même montant (fonds créés à partir
 *   de rien) et laisserait ce candidat bloqué indéfiniment dans un statut non nettoyé.
 * - `"compensate"` : le précédent candidat était `"confirmed"` (réellement débité) — remboursement
 *   réel, couvert autant que possible par la nouvelle commission ; la plateforme complète si elle est
 *   insuffisante (`platformTopUp`) ou conserve le surplus si elle est excédentaire (`platformSurplus`),
 *   sans jamais percevoir une deuxième commission pour la même livraison. */
export type ReplacementSettlement =
  | { kind: "none" }
  | { kind: "release"; amount: number }
  | { kind: "compensate"; amountOwedToPriorDriver: number; coveredByNewCommission: number; platformTopUp: number; platformSurplus: number };

export function computeReplacementSettlement(
  priorCandidate: { status: "selected" | "confirmed"; commissionBlocked: number } | null | undefined,
  newCommission: number,
): ReplacementSettlement {
  if (!priorCandidate) return { kind: "none" };
  if (priorCandidate.status === "selected") return { kind: "release", amount: priorCandidate.commissionBlocked };
  const amountOwedToPriorDriver = priorCandidate.commissionBlocked;
  const coveredByNewCommission = Math.min(newCommission, amountOwedToPriorDriver);
  return {
    kind: "compensate",
    amountOwedToPriorDriver,
    coveredByNewCommission,
    platformTopUp: Math.max(0, amountOwedToPriorDriver - coveredByNewCommission),
    platformSurplus: Math.max(0, newCommission - coveredByNewCommission),
  };
}
