import type { Delivery } from "./tikis-domain";

export type DriverHomeAction = "apply" | "withdraw" | "confirm" | "start" | "none";

export function resolveDriverHomeAction(delivery: Pick<Delivery, "status" | "ownCandidateStatus">): DriverHomeAction {
  if (delivery.ownCandidateStatus === "applied") return "withdraw";
  if (delivery.ownCandidateStatus === "selected") return "confirm";
  if (delivery.ownCandidateStatus === "confirmed" || delivery.status === "active") return "start";
  if (delivery.status === "open") return "apply";
  return "none";
}

export type SenderHomeAction = "candidates" | "cancel" | "track" | "rate" | "details";

/**
 * L'action que porte une carte de livraison sur l'accueil d'un expéditeur.
 *
 * Le libellé du bouton et son effet lisent tous deux cette fonction. Tant qu'ils
 * étaient écrits séparément, un statut couvert par l'un et pas par l'autre
 * produisait un bouton visible qui ne faisait rien : `candidateCount` absent de
 * la réponse, par exemple, affichait « Annuler » mais n'ouvrait aucune boîte.
 * `details` est le défaut : il n'existe aucun cas où la carte ne répond pas.
 */
export function resolveSenderHomeAction(
  delivery: Pick<Delivery, "status" | "candidateCount" | "driverPhone">,
): SenderHomeAction {
  if (delivery.status === "open") {
    return (delivery.candidateCount ?? 0) > 0 ? "candidates" : "cancel";
  }
  if (delivery.status === "active" || delivery.status === "pending_confirmation") return "track";
  if (delivery.status === "completed" && delivery.driverPhone) return "rate";
  return "details";
}

/** Le libellé affiché pour cette action, ou `null` quand la carte n'en propose pas. */
export function senderHomeActionLabel(action: SenderHomeAction): string | null {
  if (action === "candidates") return "Candidats";
  if (action === "cancel") return "Annuler";
  if (action === "track") return "Suivre";
  if (action === "rate") return "Noter";
  return null;
}
