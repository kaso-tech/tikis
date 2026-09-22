import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const screen = read("components/tikis/candidates-sheet.tsx");
const detail = read("app/delivery/[id].tsx");
const db = read("server/db.ts");
const domain = read("shared/tikis-domain.ts");
const routers = read("server/routers.ts");

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
    const modal = screen.slice(screen.indexOf("function ChoicePanel"));
    expect(modal).toContain("Vous paierez");
    expect(modal).toContain("Votre prix publié");
  });

  it("elle dit qui supporte la commission, au lieu de l'afficher comme le montant", () => {
    // L'ancienne confirmation réutilisait le modal financier générique, dont le
    // montant est la commission prélevée au livreur : un expéditeur acceptant
    // 4 500 FCFA y lisait « 300 FCFA ».
    const modal = screen.slice(screen.indexOf("function ChoicePanel"));
    expect(modal).toContain("reste à sa charge");
    expect(modal).not.toContain("commissionBlocked");
  });

  it("la fiche de livraison ne porte plus l'ancienne confirmation de sélection", () => {
    expect(detail).not.toContain('action === "select"');
    expect(detail).not.toContain("selectedCandidate");
    expect(detail).toContain("<CandidatesSheet visible={candidatesOpen}");
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

describe("la feuille défile, quel que soit son palier", () => {
  it("le palier vit dans un état, pas dans une ref", () => {
    // `scrollEnabled={sheetValue.current > SHEET_PEEK}` lisait une `ref`, qui ne
    // redéclenche aucun rendu : agrandir la feuille ne débloquait jamais la liste.
    expect(screen).toContain('useState<SheetLevel>("mid")');
    expect(screen).not.toMatch(/scrollEnabled=/);
  });

  it("le geste de glissement est confiné à la poignée", () => {
    // Tant que le PanResponder ne couvre pas la liste, les deux gestes ne se
    // disputent rien et le défilement n'a jamais besoin d'être coupé.
    const header = screen.slice(screen.indexOf("panResponder.panHandlers"), screen.indexOf("<ScrollView"));
    expect(header).toContain("styles.grip");
    expect(header).not.toContain("<ScrollView");
  });

  it("réutilise la géométrie de glissement déjà testée du suivi", () => {
    expect(screen).toContain('from "@/lib/sheet-gesture"');
    expect(screen).toContain("nextSheetLevel(levelRef.current, gesture.dy, gesture.vy)");
  });

  it("s’ouvre plus haut qu’avant, et se referme d’un geste franc vers le bas", () => {
    // 45 % laissaient voir deux candidats sur quatre.
    expect(screen).toContain("SCREEN_HEIGHT * 0.72");
    expect(screen).toContain('if (next === "mini") closeRef.current();');
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

describe("le badge « vérifié » reflète un vrai contrôle d'identité", () => {
  it("isVerified n'est plus une constante, il vient du statut KYC approuvé", () => {
    // C'était `isVerified: true` en dur : l'expéditeur lisait « vérifié » sur un livreur
    // dont l'identité n'avait été contrôlée par personne.
    expect(db).not.toContain("isVerified: true,");
    expect(db).toContain("isVerified: approvedDrivers.has(candidate.driverPhone)");
    expect(db).toContain('eq(tikisKycSubmissions.status, "approved")');
  });

  it("candidater exige ce même statut approuvé, pas seulement une photo de profil", () => {
    const mutation = routers.slice(routers.indexOf("submitApplication:"), routers.indexOf("update: tikisProtectedProcedure.input(deliveryInputSchema"));
    expect(mutation).toContain("getLatestKycSubmission(profile.phone)");
    expect(mutation).toContain('kyc?.status !== "approved"');
  });
});

describe("le numéro d'un candidat n'est révélé qu'une fois attribué", () => {
  it("candidateForSender masque le numéro tant que le statut n'est pas sélectionné ou confirmé", () => {
    expect(routers).toContain('candidate.status === "selected" || candidate.status === "confirmed"');
    expect(routers).toContain("driverId: candidate.id");
  });

  it("la procédure candidates applique ce masquage côté expéditeur", () => {
    const procedure = routers.slice(routers.indexOf("candidates: tikisProtectedProcedure"), routers.indexOf("submitApplication:"));
    expect(procedure).toContain("candidates.map(candidateForSender)");
  });
});
