/**
 * Comparer des candidatures : l'écart de prix, le tri, et le mieux placé.
 *
 * L'écran de candidatures sert une seule décision : choisir un livreur, ce qui
 * bloque sa commission et engage l'expéditeur sur un montant. Les trois
 * fonctions ci-dessous sont tout ce que cette décision demande, isolées du
 * rendu pour être vérifiables.
 *
 * Le prix est l'information centrale et la plus mal servie jusqu'ici : un
 * livreur qui contre-offre 4 500 FCFA sur une course publiée à 3 000 s'affichait
 * exactement comme celui qui acceptait les 3 000. `candidatePriceDelta` rend cet
 * écart explicite, et c'est lui — pas le montant brut — que l'écran met en
 * couleur.
 */

export type RankableCandidate = {
  offerPrice?: number;
  rating: number;
  completedDeliveries: number;
  isCertified: boolean;
  /** Distance entre la dernière position connue du livreur et le point de récupération.
   *  `null` ou absent quand cette position est inconnue ou trop ancienne : on ne la devine pas. */
  distanceFromPickupKm?: number | null;
  status: string;
  createdAt: string;
};

export type CandidateSort = "price" | "distance" | "rating" | "recent";

export const CANDIDATE_SORTS: { key: CandidateSort; label: string }[] = [
  { key: "price", label: "Le moins cher" },
  { key: "distance", label: "Le plus proche" },
  { key: "rating", label: "Le mieux noté" },
  { key: "recent", label: "Le plus récent" },
];

export const DEFAULT_CANDIDATE_SORT: CandidateSort = "price";

/** Ce que l'expéditeur paiera s'il choisit ce candidat : sa contre-offre, sinon le prix publié. */
export function candidatePrice(candidate: RankableCandidate, deliveryPrice: number): number {
  return candidate.offerPrice ?? deliveryPrice;
}

/** L'écart au prix publié. Positif = le livreur demande davantage. */
export function candidatePriceDelta(candidate: RankableCandidate, deliveryPrice: number): number {
  return candidatePrice(candidate, deliveryPrice) - deliveryPrice;
}

/** Une position inconnue ne vaut pas « à zéro kilomètre » : elle est classée en dernier. */
function distanceForSort(candidate: RankableCandidate): number {
  const distance = candidate.distanceFromPickupKm;
  return typeof distance === "number" && Number.isFinite(distance) ? distance : Number.POSITIVE_INFINITY;
}

function createdAtMs(candidate: RankableCandidate): number {
  const timestamp = new Date(candidate.createdAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * Trie selon le critère demandé, en départageant toujours par ancienneté décroissante :
 * sans ce second critère, deux candidats au même prix changeaient d'ordre d'un rendu à
 * l'autre, et le bouton « Choisir » se déplaçait sous le doigt.
 */
export function sortCandidates<T extends RankableCandidate>(
  candidates: readonly T[],
  deliveryPrice: number,
  sort: CandidateSort,
): T[] {
  const byRecency = (a: T, b: T) => createdAtMs(b) - createdAtMs(a);
  return [...candidates].sort((a, b) => {
    if (sort === "price") {
      const difference = candidatePrice(a, deliveryPrice) - candidatePrice(b, deliveryPrice);
      if (difference !== 0) return difference;
    }
    if (sort === "distance") {
      // Comparaison, jamais soustraction : deux positions inconnues valent toutes deux
      // `Infinity`, et `Infinity - Infinity` vaut NaN — un comparateur qui renvoie NaN
      // rend l'ordre indéterminé, donc instable d'un rendu à l'autre.
      const left = distanceForSort(a);
      const right = distanceForSort(b);
      if (left !== right) return left < right ? -1 : 1;
    }
    if (sort === "rating") {
      const difference = b.rating - a.rating;
      if (difference !== 0) return difference;
      const experience = b.completedDeliveries - a.completedDeliveries;
      if (experience !== 0) return experience;
    }
    return byRecency(a, b);
  });
}

/** Un candidat déjà retenu n'est plus en compétition : il a sa propre place dans l'écran. */
export function isCandidateInRunning(candidate: RankableCandidate): boolean {
  return candidate.status !== "selected" && candidate.status !== "confirmed" && candidate.status !== "withdrawn";
}

type Axes = { price: number; distance: number; rating: number };

function axesOf(candidate: RankableCandidate, deliveryPrice: number): Axes {
  return { price: candidatePrice(candidate, deliveryPrice), distance: distanceForSort(candidate), rating: candidate.rating };
}

/** `a` est-il au moins aussi bon que `b` partout, et strictement meilleur quelque part ? */
function dominates(a: Axes, b: Axes): boolean {
  const notWorse = a.price <= b.price && a.distance <= b.distance && a.rating >= b.rating;
  const strictlyBetter = a.price < b.price || a.distance < b.distance || a.rating > b.rating;
  return notWorse && strictlyBetter;
}

export type BestPlaced<T> = { candidate: T; reasons: string[] };

/**
 * Le candidat que l'écran met en avant — ou `null`, ce qui est le cas le plus fréquent.
 *
 * Aucune note composite, aucun poids arbitraire : un candidat n'est mis en avant que
 * s'il domine **tous** les autres au sens de Pareto (pas moins bon sur le prix, la
 * distance ni la note, et meilleur sur au moins l'un des trois). Dès qu'un arbitrage
 * existe — moins cher mais plus loin, plus proche mais moins bien noté — c'est à
 * l'expéditeur de trancher, et le bandeau disparaît plutôt que de trancher à sa place.
 *
 * Les raisons renvoyées ne sont que des faits déjà affichés sur sa ligne : le bandeau
 * résume, il n'ajoute aucune information invérifiable.
 */
export function bestPlacedCandidate<T extends RankableCandidate>(
  candidates: readonly T[],
  deliveryPrice: number,
): BestPlaced<T> | null {
  const running = candidates.filter(isCandidateInRunning);
  // Avec un seul candidat il n'y a rien à comparer : le désigner « le mieux placé »
  // serait une recommandation sans contenu.
  if (running.length < 2) return null;

  const winner = running.find((candidate) => {
    const own = axesOf(candidate, deliveryPrice);
    return running.every((other) => other === candidate || dominates(own, axesOf(other, deliveryPrice)));
  });
  if (!winner) return null;

  const delta = candidatePriceDelta(winner, deliveryPrice);
  const reasons: string[] = [];
  if (delta < 0) reasons.push(`il demande ${Math.abs(delta).toLocaleString("fr-FR")} FCFA de moins que votre prix`);
  else if (delta === 0) reasons.push("il accepte votre prix");
  if (winner.isCertified) reasons.push("il est certifié");
  const winnerDistance = distanceForSort(winner);
  const isStrictlyClosest = Number.isFinite(winnerDistance)
    && running.every((other) => other === winner || distanceForSort(other) > winnerDistance);
  if (isStrictlyClosest) reasons.push("c’est le plus proche du point de retrait");
  if (reasons.length === 0) reasons.push("c’est la meilleure combinaison prix, distance et note");
  return { candidate: winner, reasons };
}

/** « il accepte votre prix, il est certifié et c’est le plus proche. » */
export function joinReasons(reasons: readonly string[]): string {
  if (reasons.length === 0) return "";
  if (reasons.length === 1) return `${reasons[0]}.`;
  return `${reasons.slice(0, -1).join(", ")} et ${reasons[reasons.length - 1]}.`;
}
