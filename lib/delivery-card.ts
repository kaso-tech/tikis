/**
 * Ce que dit une carte de livraison dans la liste de l'accueil.
 *
 * Deux formes coexistent — « Trajet » côté expéditeur, « Registre » côté
 * livreur — mais elles disent la même chose : un état, un contexte, et un
 * signal quand il y en a un. Ces trois décisions vivent ici plutôt que dans
 * chaque variante de plateforme, pour que les deux écrans ne divergent pas.
 *
 * Remplace la table `STATUS_CHIP`, dont les couleurs s'étaient cassées sans
 * que rien ne le signale : « TERMINÉE » s'y écrivait en vert sur fond vert.
 * Un état est désormais un nom et un ton, la couleur restant au rendu.
 */

import type { Delivery, DeliveryStatus } from "@/shared/tikis-domain";

/** Le registre de couleur d'une carte, sans dire laquelle : c'est au rendu de choisir. */
export type DeliveryCardTone = "open" | "assigned" | "active" | "done" | "idle";

export function deliveryCardTone(status: DeliveryStatus): DeliveryCardTone {
  if (status === "open") return "open";
  if (status === "pending_confirmation") return "assigned";
  if (status === "active") return "active";
  if (status === "completed") return "done";
  return "idle";
}

/** Le nom de l'état, en toutes lettres plutôt qu'en capitales dans une pastille. */
export function deliveryCardStateLabel(status: DeliveryStatus): string {
  if (status === "open") return "Publiée";
  if (status === "pending_confirmation") return "Attribuée";
  if (status === "active") return "En transit";
  if (status === "completed") return "Livrée";
  if (status === "draft") return "Brouillon";
  if (status === "cancelled") return "Annulée";
  if (status === "disabled") return "Désactivée";
  return "Expirée";
}

function measure(delivery: Pick<Delivery, "type" | "passengers" | "weightKg">): string | null {
  if (delivery.type === "Personne" && delivery.passengers) {
    return `${delivery.passengers} passager${delivery.passengers > 1 ? "s" : ""}`;
  }
  if (delivery.weightKg) return `${delivery.weightKg} kg`;
  return null;
}

/**
 * Ce que l'expéditeur a décrit : son titre, et la mesure qui compte pour ce
 * type de course. Le type lui-même (« Personne ») n'y figure pas : il doublait
 * le nombre de passagers sans rien ajouter.
 */
export function deliveryCardContext(delivery: Pick<Delivery, "title" | "type" | "passengers" | "weightKg">): string {
  return [delivery.title?.trim() || delivery.type, measure(delivery)].filter(Boolean).join(", ");
}

export type DeliveryCardSignal = { kind: "candidates" | "driver"; text: string };

/**
 * La ligne qui n'apparaît que lorsqu'il y a quelque chose à dire : des livreurs
 * à comparer, ou un livreur engagé. Sur une course que personne n'a prise, elle
 * renvoie `null` et la carte ne réserve aucune place pour du vide.
 */
export function deliveryCardSignal(
  delivery: Pick<Delivery, "status" | "candidateCount" | "driverName">,
): DeliveryCardSignal | null {
  if (delivery.status === "open") {
    const count = delivery.candidateCount ?? 0;
    if (count <= 0) return null;
    return { kind: "candidates", text: `${count} candidat${count > 1 ? "s" : ""} à comparer` };
  }
  if (!delivery.driverName) return null;
  if (delivery.status === "pending_confirmation") return { kind: "driver", text: `${delivery.driverName} doit confirmer` };
  if (delivery.status === "active") return { kind: "driver", text: `${delivery.driverName} est en route` };
  return null;
}
