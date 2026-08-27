import type { Delivery, SelectableVehicleType } from "@/shared/tikis-domain";

export type DistanceLimit = "all" | 5 | 10 | 20 | 50;
export type RewardMinimum = "all" | 2000 | 5000 | 10000;
export type DeliverySort = "nearest" | "reward" | "recent";

export type DriverDeliveryFilters = {
  maxDistanceKm: DistanceLimit;
  vehicle: "all" | SelectableVehicleType;
  minReward: RewardMinimum;
  sortBy: DeliverySort;
};

export const defaultDriverDeliveryFilters: DriverDeliveryFilters = {
  maxDistanceKm: "all",
  vehicle: "all",
  minReward: "all",
  sortBy: "nearest",
};

export const distanceOptions: { value: DistanceLimit; label: string }[] = [
  { value: "all", label: "Toutes" }, { value: 5, label: "≤ 5 km" }, { value: 10, label: "≤ 10 km" }, { value: 20, label: "≤ 20 km" }, { value: 50, label: "≤ 50 km" },
];
export const rewardOptions: { value: RewardMinimum; label: string }[] = [
  { value: "all", label: "Tous les montants" }, { value: 2000, label: "Dès 2 000 FCFA" }, { value: 5000, label: "Dès 5 000 FCFA" }, { value: 10000, label: "Dès 10 000 FCFA" },
];
export const sortOptions: { value: DeliverySort; label: string; description: string }[] = [
  { value: "nearest", label: "Plus proche", description: "Distance de la course" }, { value: "reward", label: "Mieux rémunérée", description: "Prix de livraison" }, { value: "recent", label: "Plus récente", description: "Date de création" },
];

function rewardOf(delivery: Delivery) { return delivery.offeredPrice ?? delivery.estimatedPrice; }

function createdAtValue(createdAt: string) {
  const timestamp = Date.parse(createdAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function filterAndSortDriverDeliveries(deliveries: Delivery[], filters: DriverDeliveryFilters) {
  const result = deliveries.filter((delivery) => {
    if (filters.maxDistanceKm !== "all" && delivery.distanceKm > filters.maxDistanceKm) return false;
    if (filters.vehicle !== "all" && !delivery.vehicleTypes.includes(filters.vehicle)) return false;
    if (filters.minReward !== "all" && rewardOf(delivery) < filters.minReward) return false;
    return true;
  });
  return result.sort((left, right) => {
    if (filters.sortBy === "reward") return rewardOf(right) - rewardOf(left) || left.distanceKm - right.distanceKm;
    if (filters.sortBy === "recent") return createdAtValue(right.createdAt) - createdAtValue(left.createdAt) || left.distanceKm - right.distanceKm;
    return left.distanceKm - right.distanceKm || rewardOf(right) - rewardOf(left);
  });
}

export function activeDriverDeliveryFilterCount(filters: DriverDeliveryFilters) {
  return Number(filters.maxDistanceKm !== "all") + Number(filters.vehicle !== "all") + Number(filters.minReward !== "all") + Number(filters.sortBy !== "nearest");
}
