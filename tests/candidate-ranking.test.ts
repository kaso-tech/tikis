import { describe, expect, it } from "vitest";
import {
  bestPlacedCandidate,
  candidatePrice,
  candidatePriceDelta,
  isCandidateInRunning,
  joinReasons,
  sortCandidates,
  type RankableCandidate,
} from "../shared/candidate-ranking";

const PRICE = 3_000;

function candidate(overrides: Partial<RankableCandidate> & { createdAt?: string } = {}): RankableCandidate {
  return {
    rating: 4,
    completedDeliveries: 10,
    isCertified: false,
    distanceFromPickupKm: 5,
    status: "pending",
    createdAt: "2026-09-21T10:00:00.000Z",
    ...overrides,
  };
}

describe("le prix et son écart au prix publié", () => {
  it("sans contre-offre, le candidat coûte le prix publié", () => {
    expect(candidatePrice(candidate(), PRICE)).toBe(3_000);
    expect(candidatePriceDelta(candidate(), PRICE)).toBe(0);
  });

  it("une contre-offre plus élevée donne un écart positif", () => {
    const applicant = candidate({ offerPrice: 4_500 });
    expect(candidatePrice(applicant, PRICE)).toBe(4_500);
    expect(candidatePriceDelta(applicant, PRICE)).toBe(1_500);
  });

  it("une contre-offre plus basse donne un écart négatif", () => {
    expect(candidatePriceDelta(candidate({ offerPrice: 2_800 }), PRICE)).toBe(-200);
  });
});

describe("le tri", () => {
  const cheap = candidate({ offerPrice: 2_500, createdAt: "2026-09-21T09:00:00.000Z" });
  const expensive = candidate({ offerPrice: 4_500, createdAt: "2026-09-21T11:00:00.000Z" });
  const near = candidate({ distanceFromPickupKm: 0.8, createdAt: "2026-09-21T08:00:00.000Z" });
  const pool = [expensive, near, cheap];

  it("par prix, du moins cher au plus cher", () => {
    expect(sortCandidates(pool, PRICE, "price").map((c) => candidatePrice(c, PRICE))).toEqual([2_500, 3_000, 4_500]);
  });

  it("par distance, du plus proche au plus loin", () => {
    expect(sortCandidates(pool, PRICE, "distance")[0]).toBe(near);
  });

  it("une position inconnue est classée en dernier, jamais comme une distance nulle", () => {
    const unknown = candidate({ distanceFromPickupKm: null });
    const far = candidate({ distanceFromPickupKm: 40 });
    expect(sortCandidates([unknown, far], PRICE, "distance")).toEqual([far, unknown]);
  });

  it("deux positions inconnues ne rendent pas l'ordre indéterminé", () => {
    // `Infinity - Infinity` vaut NaN : un comparateur qui le renvoie laisse
    // l'ordre au hasard de l'implémentation du tri.
    const older = candidate({ distanceFromPickupKm: null, createdAt: "2026-09-21T08:00:00.000Z" });
    const newer = candidate({ distanceFromPickupKm: null, createdAt: "2026-09-21T12:00:00.000Z" });
    expect(sortCandidates([older, newer], PRICE, "distance")).toEqual([newer, older]);
  });

  it("par note, puis par expérience à note égale", () => {
    const seasoned = candidate({ rating: 4.6, completedDeliveries: 120 });
    const novice = candidate({ rating: 4.6, completedDeliveries: 3 });
    const best = candidate({ rating: 4.9, completedDeliveries: 8 });
    expect(sortCandidates([novice, seasoned, best], PRICE, "rating")).toEqual([best, seasoned, novice]);
  });

  it("à critère égal, l'ordre reste stable : la candidature la plus récente d'abord", () => {
    const older = candidate({ createdAt: "2026-09-21T08:00:00.000Z" });
    const newer = candidate({ createdAt: "2026-09-21T12:00:00.000Z" });
    expect(sortCandidates([older, newer], PRICE, "price")).toEqual([newer, older]);
  });

  it("ne modifie jamais le tableau reçu", () => {
    const pristine = [expensive, cheap];
    sortCandidates(pristine, PRICE, "price");
    expect(pristine).toEqual([expensive, cheap]);
  });
});

describe("le candidat mis en avant", () => {
  it("n'existe pas tant qu'il n'y a qu'un candidat : il n'y a rien à comparer", () => {
    expect(bestPlacedCandidate([candidate()], PRICE)).toBeNull();
  });

  it("désigne celui qui n'est moins bon nulle part", () => {
    const winner = candidate({ offerPrice: 2_800, distanceFromPickupKm: 1.2, rating: 4.9, isCertified: true });
    const other = candidate({ offerPrice: 3_000, distanceFromPickupKm: 3.8, rating: 4.4 });
    expect(bestPlacedCandidate([other, winner], PRICE)?.candidate).toBe(winner);
  });

  it("disparaît dès qu'un arbitrage existe : moins cher mais plus loin", () => {
    const cheaper = candidate({ offerPrice: 2_500, distanceFromPickupKm: 9 });
    const closer = candidate({ offerPrice: 3_000, distanceFromPickupKm: 1 });
    expect(bestPlacedCandidate([cheaper, closer], PRICE)).toBeNull();
  });

  it("ignore un candidat déjà retenu ou retiré", () => {
    const chosen = candidate({ status: "selected", offerPrice: 1_000, distanceFromPickupKm: 0.1, rating: 5 });
    const a = candidate({ offerPrice: 2_800, distanceFromPickupKm: 1, rating: 4.9 });
    const b = candidate({ offerPrice: 3_000, distanceFromPickupKm: 4, rating: 4.1 });
    expect(bestPlacedCandidate([chosen, a, b], PRICE)?.candidate).toBe(a);
  });

  it("ne justifie qu'avec des faits déjà affichés sur sa ligne", () => {
    const winner = candidate({ distanceFromPickupKm: 1.2, rating: 4.9, isCertified: true });
    const other = candidate({ offerPrice: 4_500, distanceFromPickupKm: 3.8, rating: 4.4 });
    const best = bestPlacedCandidate([other, winner], PRICE);
    expect(best?.reasons).toEqual(["il accepte votre prix", "il est certifié", "c’est le plus proche du point de retrait"]);
  });

  it("ne dit pas « le plus proche » quand sa position est inconnue", () => {
    const winner = candidate({ offerPrice: 2_500, distanceFromPickupKm: null, rating: 4.9 });
    const other = candidate({ offerPrice: 3_000, distanceFromPickupKm: null, rating: 4.1 });
    const best = bestPlacedCandidate([other, winner], PRICE);
    expect(best?.candidate).toBe(winner);
    expect(best?.reasons.join(" ")).not.toContain("proche");
  });
});

describe("les candidats encore en lice", () => {
  it.each([
    ["pending", true],
    ["selected", false],
    ["confirmed", false],
    ["withdrawn", false],
  ])("%s → %s", (status, expected) => {
    expect(isCandidateInRunning(candidate({ status }))).toBe(expected);
  });
});

describe("la phrase de justification", () => {
  it("relie les raisons sans virgule finale", () => {
    expect(joinReasons(["il accepte votre prix", "il est certifié", "c’est le plus proche"]))
      .toBe("il accepte votre prix, il est certifié et c’est le plus proche.");
  });

  it("une seule raison reste une phrase", () => {
    expect(joinReasons(["il est certifié"])).toBe("il est certifié.");
  });
});
