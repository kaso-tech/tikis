import { describe, expect, it } from "vitest";
import { compactRouteLabel, estimateDeliveryPrice, geodesicDistanceKm, normalizeLocation, sanitizePlaceText, validateDeliveryMeasurement } from "../lib/geo-rules";

describe("règles géographiques et estimation Tikis", () => {
  const pickup = { name: "Maison du Peuple", district: "Koulouba", city: "Ouagadougou", latitude: 12.3714, longitude: -1.5197 };
  const dropoff = { name: "Stade du 4 Août", district: "Gounghin", city: "Ouagadougou", latitude: 12.3588, longitude: -1.5352 };

  it("protège et normalise les lieux avec leurs coordonnées", () => {
    expect(sanitizePlaceText("  <Maison>  du  Peuple<script> ")).toBe("Maison du Peuplescript");
    expect(normalizeLocation(pickup)?.city).toBe("Ouagadougou");
    expect(normalizeLocation({ ...pickup, latitude: 98 })).toBeNull();
    expect(compactRouteLabel(pickup, dropoff)).toBe("Maison du Peuple → Stade du 4 Août");
  });

  it("calcule une distance GPS et adapte l’estimation au type de livraison", () => {
    const distance = geodesicDistanceKm(pickup, dropoff);
    expect(distance).toBeGreaterThan(1);
    const pli = estimateDeliveryPrice({ distanceKm: distance, type: "Plis", vehicle: "Moto" });
    const cargo = estimateDeliveryPrice({ distanceKm: distance, type: "Autre", vehicle: "Moto", weightKg: 30, dimensions: { lengthCm: 80, widthCm: 50, heightCm: 40 } });
    const passenger = estimateDeliveryPrice({ distanceKm: distance, type: "Personne", vehicle: "Voiture", passengers: 3 });
    expect(cargo).toBeGreaterThan(pli);
    expect(passenger).toBeGreaterThan(pli);
  });

  it("impose les seules mesures pertinentes à chaque type", () => {
    expect(validateDeliveryMeasurement("Personne", { passengers: 0 })).toContain("1 et 4");
    expect(validateDeliveryMeasurement("Autre", { weightKg: 501 })).toContain("500 kg");
    expect(validateDeliveryMeasurement("Plis", {})).toBeNull();
  });
});

