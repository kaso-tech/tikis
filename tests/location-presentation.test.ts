import { describe, expect, it } from "vitest";
import { formatDeliveryDetailPlace, formatFavoritePlace, formatListRoute, formatListRouteParts, formatNavigationTarget, normalizeLocation } from "../lib/geo-rules";
import type { LocationLabel } from "../shared/tikis-domain";

const place = (overrides: Partial<LocationLabel>): LocationLabel => ({
  name: "Point sélectionné",
  district: "",
  city: "",
  latitude: 12.37,
  longitude: -1.52,
  ...overrides,
});

describe("présentation métier des lieux Tikis", () => {
  it("A — affiche deux POI locaux lorsqu’ils sont dans la même ville", () => {
    expect(formatListRoute(place({ name: "Maison du Peuple", district: "Koulouba", city: "Ouagadougou" }), place({ name: "Stade du 4 Août", district: "Gounghin", city: "Ouagadougou" }))).toBe("Maison du Peuple → Stade du 4 Août");
  });

  it("B — affiche deux quartiers locaux dans la même ville", () => {
    expect(formatListRoute(place({ district: "Karpala", city: "Ouagadougou" }), place({ district: "Ouaga 2000", city: "Ouagadougou" }))).toBe("Karpala → Ouaga 2000");
  });

  it("C — privilégie les villes lorsqu’elles diffèrent", () => {
    const route = formatListRouteParts(place({ name: "Hôtel Indépendance", city: "Ouagadougou" }), place({ name: "Gare routière", city: "Koudougou" }));
    expect(route).toEqual({ pickup: "Ouagadougou", dropoff: "Koudougou", sameCity: false });
  });

  it("D — ne crée pas de séparateur vide lorsqu’un quartier est absent", () => {
    expect(formatDeliveryDetailPlace(place({ name: "Pharmacie Centrale", city: "Bobo-Dioulasso" }))).toEqual({ title: "Pharmacie Centrale", subtitle: "Bobo-Dioulasso" });
  });

  it("E — utilise la rue lorsqu’aucun nom de lieu n’est disponible", () => {
    expect(formatFavoritePlace(place({ name: "", street: "Avenue Kwame Nkrumah", city: "Ouagadougou" }))).toBe("Avenue Kwame Nkrumah");
  });

  it("F — utilise la ville comme dernier niveau local utile", () => {
    expect(formatFavoritePlace(place({ name: "", city: "Dori" }))).toBe("Dori");
  });

  it("G — utilise la région lorsque la ville est inconnue", () => {
    expect(formatDeliveryDetailPlace(place({ name: "", province: "Sahel" }))).toEqual({ title: "Sahel", subtitle: "Coordonnées GPS enregistrées" });
  });

  it("H — conserve l’adresse complète pour la navigation", () => {
    const location = place({ name: "Agence Tikis", district: "Koulouba", city: "Ouagadougou", formattedAddress: "12 Avenue Kwame Nkrumah, Koulouba, Ouagadougou, Burkina Faso" });
    expect(formatNavigationTarget(location)).toBe(location.formattedAddress);
  });

  it("I — conserve la provenance et la précision du lieu résolu", () => {
    const normalized = normalizeLocation(place({ name: "Agence Tikis", city: "Ouagadougou", provider: "mapbox", source: "retrieve", featureType: "poi", precision: "exact" }));
    expect(normalized).toMatchObject({ provider: "mapbox", source: "retrieve", featureType: "poi", precision: "exact" });
  });

  it("J — exige de vraies coordonnées pour qu’un lieu soit sélectionnable", () => {
    expect(normalizeLocation({ name: "Suggestion", city: "Ouagadougou", latitude: Number.NaN, longitude: -1.52 })).toBeNull();
  });
});
