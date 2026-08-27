import { describe, expect, it } from "vitest";
import { activeDriverDeliveryFilterCount, defaultDriverDeliveryFilters, filterAndSortDriverDeliveries } from "../lib/delivery-filters";
import type { Delivery } from "../shared/tikis-domain";

const deliveries: Delivery[] = [
  { id: "near", senderPhone: "+22670000001", senderName: "Awa", title: "Plis proche", type: "Plis", pickup: { name: "A", district: "Centre", city: "Ouagadougou", latitude: 12.37, longitude: -1.51 }, dropoff: { name: "B", district: "Centre", city: "Ouagadougou", latitude: 12.38, longitude: -1.52 }, distanceKm: 3, routeSource: "routes", estimatedPrice: 1800, offeredPrice: 3000, vehicleTypes: ["Vélo"], details: "Plis", status: "open", scheduledAt: "Dès maintenant", createdAt: "2026-08-26T10:00:00.000Z" },
  { id: "moto", senderPhone: "+22670000002", senderName: "Issa", title: "Moto rentable", type: "Autre", pickup: { name: "C", district: "Koulouba", city: "Ouagadougou", latitude: 12.36, longitude: -1.52 }, dropoff: { name: "D", district: "Karpala", city: "Ouagadougou", latitude: 12.32, longitude: -1.55 }, distanceKm: 12, routeSource: "routes", estimatedPrice: 6000, offeredPrice: 7500, vehicleTypes: ["Moto"], details: "Colis", status: "open", scheduledAt: "Dès maintenant", createdAt: "2026-08-27T10:00:00.000Z" },
  { id: "car", senderPhone: "+22670000003", senderName: "Mariam", title: "Voiture premium", type: "Personne", pickup: { name: "E", district: "Gounghin", city: "Ouagadougou", latitude: 12.35, longitude: -1.50 }, dropoff: { name: "F", district: "Ouaga 2000", city: "Ouagadougou", latitude: 12.28, longitude: -1.57 }, distanceKm: 25, routeSource: "routes", estimatedPrice: 12000, vehicleTypes: ["Voiture"], details: "Course", status: "open", scheduledAt: "Dès maintenant", createdAt: "2026-08-25T10:00:00.000Z" },
];

describe("filtres avancés livreur", () => {
  it("combine distance, engin et rémunération sans modifier les livraisons source", () => {
    const result = filterAndSortDriverDeliveries(deliveries, { ...defaultDriverDeliveryFilters, maxDistanceKm: 20, vehicle: "Moto", minReward: 5000 });
    expect(result.map((delivery) => delivery.id)).toEqual(["moto"]);
    expect(deliveries).toHaveLength(3);
  });

  it("trie par proximité, rémunération ou récence", () => {
    expect(filterAndSortDriverDeliveries(deliveries, defaultDriverDeliveryFilters).map((delivery) => delivery.id)).toEqual(["near", "moto", "car"]);
    expect(filterAndSortDriverDeliveries(deliveries, { ...defaultDriverDeliveryFilters, sortBy: "reward" }).map((delivery) => delivery.id)).toEqual(["car", "moto", "near"]);
    expect(filterAndSortDriverDeliveries(deliveries, { ...defaultDriverDeliveryFilters, sortBy: "recent" }).map((delivery) => delivery.id)).toEqual(["moto", "near", "car"]);
  });

  it("compte uniquement les critères non standards", () => {
    expect(activeDriverDeliveryFilterCount(defaultDriverDeliveryFilters)).toBe(0);
    expect(activeDriverDeliveryFilterCount({ ...defaultDriverDeliveryFilters, maxDistanceKm: 10, vehicle: "Moto", minReward: 5000 })).toBe(3);
  });
});
