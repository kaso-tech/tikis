/**
 * L'ordre dans lequel un livreur voit les courses.
 *
 * Deux règles, dans cet ordre.
 *
 * D'abord l'engagement : ce que le livreur a déjà accepté, ou sur quoi il a
 * déjà candidaté, passe avant ce qu'il pourrait prendre. Une course en cours ne
 * doit jamais descendre sous une annonce, quel qu'en soit le prix.
 *
 * Ensuite le prix, et seulement entre les annonces ouvertes : c'est la
 * contrepartie de la majoration proposée à l'expéditeur au moment de publier
 * (`lib/price-suggestions.ts`). Tant que la liste restait triée par date, la
 * phrase « votre course part en tête » n'était vraie nulle part.
 *
 * Le classement vivait en double : côté web, une fonction privée triait par
 * priorité puis par distance du trajet ; côté natif, rien ne triait et l'ordre
 * du serveur passait tel quel. Deux livreurs voyaient donc deux listes.
 */

import type { Delivery } from "./tikis-domain";

type Sortable = Pick<Delivery, "status" | "ownCandidateStatus" | "offeredPrice" | "estimatedPrice" | "createdAt">;

/** Plus le rang est petit, plus la course engage déjà le livreur. */
export function driverOpportunityRank(delivery: Pick<Delivery, "status" | "ownCandidateStatus">): number {
  if (delivery.ownCandidateStatus === "confirmed" || delivery.status === "active") return 0;
  if (delivery.ownCandidateStatus === "selected" || delivery.status === "pending_confirmation") return 1;
  if (delivery.ownCandidateStatus === "applied") return 2;
  if (delivery.status === "open") return 3;
  return 4;
}

/** Ce que la course rapporte : le prix proposé par l'expéditeur, à défaut l'estimation. */
export function driverOpportunityPrice(delivery: Pick<Delivery, "offeredPrice" | "estimatedPrice">): number {
  const offered = delivery.offeredPrice;
  if (typeof offered === "number" && Number.isFinite(offered) && offered > 0) return offered;
  const estimated = delivery.estimatedPrice;
  return typeof estimated === "number" && Number.isFinite(estimated) ? estimated : 0;
}

function publishedAt(delivery: Pick<Delivery, "createdAt">): number {
  const time = new Date(delivery.createdAt).getTime();
  return Number.isFinite(time) ? time : 0;
}

/** Rend une nouvelle liste ordonnée ; n'altère pas celle reçue. */
export function sortDriverOpportunities<T extends Sortable>(deliveries: readonly T[]): T[] {
  return [...deliveries].sort((left, right) => {
    const rank = driverOpportunityRank(left) - driverOpportunityRank(right);
    if (rank !== 0) return rank;
    // Le prix ne départage que les annonces ouvertes. Entre deux courses déjà
    // engagées, il n'y a rien à arbitrer : c'est la plus récente qui prime.
    if (driverOpportunityRank(left) === 3) {
      const price = driverOpportunityPrice(right) - driverOpportunityPrice(left);
      if (price !== 0) return price;
    }
    return publishedAt(right) - publishedAt(left);
  });
}
