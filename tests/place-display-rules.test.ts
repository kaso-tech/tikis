import { describe, expect, it } from "vitest";
import { formatDeliveryDetailPlace, formatListRoute, formatFavoritePlace } from "../lib/geo-rules";

/**
 * Les cas de docs/logique-metier-lieux.md : §7 (même ville),
 * §8 (villes différentes), §10 (page de détail) et §21 (cas A à G).
 *
 * L'ordre attendu dans une liste est : nom du lieu public, puis quartier, puis
 * rue, puis ville. La rue passait avant le quartier, ce que ces cas verrouillent
 * désormais dans l'autre sens.
 */
const coords = { latitude: 12.3714, longitude: -1.5197 };
const place = (fields: Record<string, unknown>) => ({ ...coords, name: "", district: "", city: "", ...fields }) as never;

describe("libellés de lieux — liste des livraisons", () => {
  it("cas A — deux lieux publics connus : leurs noms", () => {
    const a = place({ name: "Maison du Peuple", district: "Koulouba", city: "Ouagadougou", featureType: "poi" });
    const b = place({ name: "Stade du 4 Août", district: "Gounghin", city: "Ouagadougou", featureType: "poi" });
    expect(formatListRoute(a, b)).toBe("Maison du Peuple → Stade du 4 Août");
  });

  it("cas B — même ville, pas de nom d’établissement : les quartiers", () => {
    const a = place({ name: "Karpala", district: "Karpala", city: "Ouagadougou", featureType: "neighborhood" });
    const b = place({ name: "Ouaga 2000", district: "Ouaga 2000", city: "Ouagadougou", featureType: "neighborhood" });
    expect(formatListRoute(a, b)).toBe("Karpala → Ouaga 2000");
  });

  it("le quartier passe avant la rue lorsque le lieu n’est pas public", () => {
    const a = place({ name: "Rue du Chemin de Fer", street: "Rue du Chemin de Fer", district: "Gounghin Nord", city: "Ouagadougou", featureType: "address" });
    const b = place({ name: "Rue Patrice Lumumba", street: "Rue Patrice Lumumba", district: "Bilbalogho", city: "Ouagadougou", featureType: "street" });
    expect(formatListRoute(a, b)).toBe("Gounghin Nord → Bilbalogho");
  });

  it("la rue ne sert que faute de quartier", () => {
    const a = place({ name: "Rue 14.38", street: "Rue 14.38", city: "Ouagadougou", featureType: "address" });
    const b = place({ name: "Rue 22.11", street: "Rue 22.11", city: "Ouagadougou", featureType: "address" });
    expect(formatListRoute(a, b)).toBe("Rue 14.38 → Rue 22.11");
  });

  it("cas C — villes différentes : uniquement les villes", () => {
    const a = place({ name: "Maison du Peuple", district: "Koulouba", city: "Ouagadougou", featureType: "poi" });
    const b = place({ name: "Marché central", district: "Secteur 4", city: "Koudougou", featureType: "poi" });
    expect(formatListRoute(a, b)).toBe("Ouagadougou → Koudougou");
  });

  it("cas D — quartier absent : le nom public suffit", () => {
    const a = place({ name: "Hôpital Yalgado", city: "Ouagadougou", featureType: "poi" });
    const b = place({ name: "Pissy", district: "Pissy", city: "Ouagadougou", featureType: "neighborhood" });
    expect(formatListRoute(a, b)).toBe("Hôpital Yalgado → Pissy");
  });

  it("cas G — hors agglomération : on descend au niveau disponible", () => {
    const a = place({ name: "Koudougou", city: "Koudougou", featureType: "locality" });
    const b = place({ name: "Gonse", city: "Gonse", featureType: "locality" });
    expect(formatListRoute(a, b)).toBe("Koudougou → Gonse");
  });
});

describe("libellés de lieux — fiche livraison et favoris", () => {
  it("§10 — la fiche détaille nom, quartier puis ville", () => {
    const detail = formatDeliveryDetailPlace(place({ name: "Alimentation Bon Samaritain", district: "Karpala", city: "Ouagadougou", featureType: "poi" }));
    expect(detail.title).toBe("Alimentation Bon Samaritain");
    expect(detail.subtitle).toBe("Karpala / Ouagadougou");
  });

  it("§13 — aucune valeur vide ne se retrouve dans le libellé", () => {
    const detail = formatDeliveryDetailPlace(place({ name: "Maison du Peuple", district: "", city: "Ouagadougou", featureType: "poi" }));
    expect(detail.subtitle).toBe("Ouagadougou");
    expect(detail.subtitle).not.toContain("undefined");
  });

  it("§11 — un favori garde le nom le plus naturel", () => {
    expect(formatFavoritePlace(place({ name: "Maison du Peuple", district: "Koulouba", city: "Ouagadougou", featureType: "poi" }))).toBe("Maison du Peuple");
    expect(formatFavoritePlace(place({ name: "Karpala", district: "Karpala", city: "Ouagadougou", featureType: "neighborhood" }))).toBe("Karpala");
  });
});
