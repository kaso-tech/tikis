import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const screen = read("app/delivery/[id]/candidates.tsx");
const detail = read("app/delivery/[id].tsx");
const db = read("server/db.ts");
const domain = read("shared/tikis-domain.ts");

describe("la distance affichée est réelle, ou avouée inconnue", () => {
  it("aucune distance n'est écrite en dur dans l'écran", () => {
    // L'ancienne carte affichait « 1,2 km » pour tout le monde, à côté d'une
    // flèche de cap bloquée à 0°.
    expect(screen).not.toMatch(/\d,\d\s*km"/);
    expect(screen).not.toContain("bearingDeg");
  });

  it("elle vient du serveur et vaut `null` quand la position manque", () => {
    expect(domain).toContain("distanceFromPickupKm: number | null;");
    expect(db).toContain("distanceFromPickupKm: distanceByDriver.get(candidate.driverPhone) ?? null");
  });

  it("une position trop ancienne est écartée plutôt qu'approchée", () => {
    const helper = db.slice(db.indexOf("async function distancesFromPickup"));
    expect(helper).toContain("BASE_POSITION_MAX_AGE_MS");
    // La latitude 0 est une coordonnée valide : un test de véracité la rejetterait.
    expect(helper).toContain("perimeter?.baseLatitude == null");
  });

  it("l'écran dit « position inconnue » au lieu d'un chiffre inventé", () => {
    expect(screen).toContain("position inconnue");
  });
});

describe("le prix porte toujours son écart au prix publié", () => {
  it("l'écran affiche un delta, pas seulement un montant", () => {
    expect(screen).toContain("candidatePriceDelta");
    expect(screen).toContain("votre prix");
  });

  it("le sens de l'écart est porté par la couleur du thème, pas par une teinte codée", () => {
    expect(screen).toContain("delta > 0 ? theme.warning : theme.success");
  });
});

describe("la confirmation montre ce que l'expéditeur va payer", () => {
  it("elle annonce le total à sa charge", () => {
    const modal = screen.slice(screen.indexOf("function ChoiceModal"));
    expect(modal).toContain("Vous paierez");
    expect(modal).toContain("Votre prix publié");
  });

  it("elle dit qui supporte la commission, au lieu de l'afficher comme le montant", () => {
    // L'ancienne confirmation réutilisait le modal financier générique, dont le
    // montant est la commission prélevée au livreur : un expéditeur acceptant
    // 4 500 FCFA y lisait « 300 FCFA ».
    const modal = screen.slice(screen.indexOf("function ChoiceModal"));
    expect(modal).toContain("retenue sur le compte du livreur");
    expect(modal).not.toContain("commissionBlocked");
  });

  it("la fiche de livraison ne porte plus l'ancienne confirmation de sélection", () => {
    expect(detail).not.toContain('action === "select"');
    expect(detail).not.toContain("selectedCandidate");
    expect(detail).toContain("/candidates` as any)");
  });
});

describe("le rappel de la course ne répète pas la même ville", () => {
  it("l'itinéraire passe par le formateur partagé", () => {
    // « Ouagadougou → Ouagadougou » : deux points de la même ville affichés par
    // leur ville n'apprennent rien. `formatListRoute` retombe sur le repère local.
    expect(screen).toContain("formatListRoute(delivery.pickup, delivery.dropoff)");
    expect(screen).not.toContain("delivery.pickup.city}");
  });
});

describe("le compteur du filtre ne promet que ce que la liste montre", () => {
  it("il se lit sur le vivier de la liste, pas sur tous les candidats", () => {
    // Le candidat du bandeau n'est plus dans la liste : le compter ferait
    // annoncer « Certifiés 1 » à un filtre qui ne rendrait aucune ligne.
    expect(screen).toContain("pool.filter((candidate) => candidate.isCertified).length");
  });
});

describe("le bandeau de mise en avant reste vérifiable", () => {
  it("il est construit par la logique partagée, pas par une note maison", () => {
    expect(screen).toContain("bestPlacedCandidate(candidates, deliveryPrice)");
    expect(screen).toContain("joinReasons(best.reasons)");
  });

  it("il s'efface dès qu'un livreur est retenu", () => {
    expect(screen).toContain("chosen ? null : bestPlacedCandidate");
  });
});
