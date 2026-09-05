import { describe, expect, it } from "vitest";

import {
  BASE_POSITION_MAX_AGE_MS,
  DEFAULT_DRIVER_PERIMETER,
  describePerimeter,
  distanceKmBetween,
  evaluatePerimeter,
  isSameCity,
  isValidPerimeterRadius,
  normalizeCityName,
} from "../shared/driver-perimeter";

const OUAGADOUGOU = { latitude: 12.3714, longitude: -1.5197 };
const BOBO_DIOULASSO = { latitude: 11.1771, longitude: -4.2979 };

describe("périmètre livreur — réglages par défaut", () => {
  it("n'active pas les alertes push tant que le livreur ne l'a pas demandé", () => {
    expect(DEFAULT_DRIVER_PERIMETER.opportunityPushEnabled).toBe(false);
  });

  it("limite par défaut les deux périmètres à la ville du livreur", () => {
    expect(DEFAULT_DRIVER_PERIMETER.alertRadiusKm).toBeNull();
    expect(DEFAULT_DRIVER_PERIMETER.discoveryRadiusKm).toBeNull();
  });
});

describe("comparaison de villes", () => {
  it("ignore la casse et les accents", () => {
    expect(isSameCity("Ouagadougou", "ouagadougou")).toBe(true);
    expect(isSameCity("Kédougou", "Kedougou")).toBe(true);
  });

  it("ignore les tirets et espaces multiples", () => {
    expect(normalizeCityName("Bobo-Dioulasso")).toBe(normalizeCityName("Bobo  Dioulasso"));
    expect(isSameCity("Bobo-Dioulasso", "bobo dioulasso")).toBe(true);
  });

  it("ne considère jamais deux villes inconnues comme identiques", () => {
    expect(isSameCity(null, null)).toBe(false);
    expect(isSameCity("", "")).toBe(false);
    expect(isSameCity("Ouagadougou", "Bobo-Dioulasso")).toBe(false);
  });
});

describe("validation du rayon", () => {
  it("accepte un entier dans les bornes", () => {
    expect(isValidPerimeterRadius(10)).toBe(true);
    expect(isValidPerimeterRadius(1)).toBe(true);
    expect(isValidPerimeterRadius(200)).toBe(true);
  });

  it("refuse zéro, le hors-bornes et le non-entier", () => {
    expect(isValidPerimeterRadius(0)).toBe(false);
    expect(isValidPerimeterRadius(201)).toBe(false);
    expect(isValidPerimeterRadius(7.5)).toBe(false);
    expect(isValidPerimeterRadius(null)).toBe(false);
  });
});

describe("mode ville (défaut)", () => {
  const base = null;

  it("retient une course publiée dans la ville du livreur", () => {
    const decision = evaluatePerimeter({
      radiusKm: null,
      driverCity: "Ouagadougou",
      base,
      pickup: { ...OUAGADOUGOU, city: "ouagadougou" },
    });
    expect(decision).toEqual({ matches: true, mode: "city", distanceKm: null });
  });

  it("écarte une course publiée dans une autre ville", () => {
    const decision = evaluatePerimeter({
      radiusKm: null,
      driverCity: "Ouagadougou",
      base,
      pickup: { ...BOBO_DIOULASSO, city: "Bobo-Dioulasso" },
    });
    expect(decision.matches).toBe(false);
    expect(decision.mode).toBe("city");
  });

  it("laisse tout passer si le livreur n'a pas renseigné sa ville", () => {
    const decision = evaluatePerimeter({
      radiusKm: null,
      driverCity: null,
      base,
      pickup: { ...BOBO_DIOULASSO, city: "Bobo-Dioulasso" },
    });
    expect(decision.matches).toBe(true);
  });

  it("laisse passer une course dont le géocodage n'a pas produit de ville", () => {
    for (const city of [null, "", "   "]) {
      const decision = evaluatePerimeter({
        radiusKm: null,
        driverCity: "Ouagadougou",
        base,
        pickup: { ...BOBO_DIOULASSO, city },
      });
      expect(decision.matches).toBe(true);
    }
  });
});

describe("mode rayon", () => {
  const freshBase = { latitude: OUAGADOUGOU.latitude, longitude: OUAGADOUGOU.longitude, updatedAt: new Date().toISOString() };

  it("retient une course dans le rayon choisi", () => {
    const decision = evaluatePerimeter({
      radiusKm: 10,
      driverCity: "Ouagadougou",
      base: freshBase,
      // ~5 km au nord du centre de Ouagadougou.
      pickup: { latitude: 12.4164, longitude: -1.5197, city: "Ouagadougou" },
    });
    expect(decision.mode).toBe("radius");
    expect(decision.matches).toBe(true);
    expect(decision.distanceKm).toBeLessThan(10);
  });

  it("écarte une course au-delà du rayon, même dans la même ville", () => {
    const decision = evaluatePerimeter({
      radiusKm: 5,
      driverCity: "Ouagadougou",
      base: freshBase,
      pickup: { ...BOBO_DIOULASSO, city: "Ouagadougou" },
    });
    expect(decision.mode).toBe("radius");
    expect(decision.matches).toBe(false);
  });

  it("retient une course hors ville mais dans le rayon", () => {
    const decision = evaluatePerimeter({
      radiusKm: 50,
      driverCity: "Ouagadougou",
      base: freshBase,
      pickup: { latitude: 12.55, longitude: -1.55, city: "Ziniaré" },
    });
    expect(decision.matches).toBe(true);
  });

  it("repasse en mode ville quand aucune position de référence n'est connue", () => {
    const decision = evaluatePerimeter({
      radiusKm: 50,
      driverCity: "Ouagadougou",
      base: { latitude: null, longitude: null, updatedAt: null },
      pickup: { ...BOBO_DIOULASSO, city: "Bobo-Dioulasso" },
    });
    expect(decision.mode).toBe("city");
    expect(decision.matches).toBe(false);
  });

  it("repasse en mode ville quand la position de référence est périmée", () => {
    const staleBase = {
      latitude: OUAGADOUGOU.latitude,
      longitude: OUAGADOUGOU.longitude,
      updatedAt: new Date(Date.now() - BASE_POSITION_MAX_AGE_MS - 60_000).toISOString(),
    };
    const decision = evaluatePerimeter({
      radiusKm: 50,
      driverCity: "Ouagadougou",
      base: staleBase,
      pickup: { latitude: 12.4164, longitude: -1.5197, city: "Ouagadougou" },
    });
    expect(decision.mode).toBe("city");
    expect(decision.matches).toBe(true);
  });
});

describe("mode ville — granularité des libellés du géocodeur", () => {
  const freshBase = { latitude: OUAGADOUGOU.latitude, longitude: OUAGADOUGOU.longitude, updatedAt: new Date().toISOString() };

  it("reconnaît la ville rangée dans le district (locality Mapbox)", () => {
    const decision = evaluatePerimeter({
      radiusKm: null,
      driverCity: "Ouagadougou",
      base: null,
      pickup: { ...OUAGADOUGOU, city: "Centre", district: "Ouagadougou" },
    });
    expect(decision.matches).toBe(true);
  });

  it("reconnaît la ville rangée dans la province", () => {
    const decision = evaluatePerimeter({
      radiusKm: null,
      driverCity: "Ouagadougou",
      base: null,
      pickup: { ...OUAGADOUGOU, city: "Kadiogo", province: "Ouagadougou" },
    });
    expect(decision.matches).toBe(true);
  });

  it("retient un point proche quand les libellés ne concordent pas mais que la position le confirme", () => {
    const decision = evaluatePerimeter({
      radiusKm: null,
      driverCity: "Ouagadougou",
      base: freshBase,
      // ~5 km du centre, mais stocké sous le nom de la région par le géocodeur.
      pickup: { latitude: 12.4164, longitude: -1.5197, city: "Centre", district: "Kadiogo" },
    });
    expect(decision.matches).toBe(true);
    expect(decision.mode).toBe("city");
  });

  it("écarte un point lointain même avec une position de référence", () => {
    const decision = evaluatePerimeter({
      radiusKm: null,
      driverCity: "Ouagadougou",
      base: freshBase,
      pickup: { ...BOBO_DIOULASSO, city: "Hauts-Bassins", district: "Bobo-Dioulasso" },
    });
    expect(decision.matches).toBe(false);
  });
});

describe("distance et libellés", () => {
  it("mesure une distance connue avec une tolérance raisonnable", () => {
    // Ouagadougou ↔ Bobo-Dioulasso : ~330 km à vol d'oiseau (la route, elle, fait ~360 km).
    expect(distanceKmBetween(OUAGADOUGOU, BOBO_DIOULASSO)).toBeGreaterThan(320);
    expect(distanceKmBetween(OUAGADOUGOU, BOBO_DIOULASSO)).toBeLessThan(340);
  });

  it("décrit le périmètre en français", () => {
    expect(describePerimeter(null)).toBe("Ma ville");
    expect(describePerimeter(null, "Ouagadougou")).toBe("Ma ville (Ouagadougou)");
    expect(describePerimeter(20)).toBe("20 km autour de moi");
  });
});
