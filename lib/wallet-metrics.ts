import type { FinancialRecord } from "@/shared/tikis-domain";

export function isDeliveryEarning(entry: FinancialRecord): boolean {
  return entry.operation === "credit" && Boolean(entry.deliveryId);
}

export function deliveryMetricsForDay(entries: FinancialRecord[], now = new Date()) {
  const isSameDay = (entry: FinancialRecord) => {
    const date = new Date(entry.createdAt);
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  };
  const todayEarnings = entries.filter((entry) => isSameDay(entry) && isDeliveryEarning(entry));
  return {
    activityCount: entries.filter((entry) => isSameDay(entry) && Boolean(entry.deliveryId)).length,
    earnings: todayEarnings.reduce((sum, entry) => sum + entry.amount, 0),
    completedCourses: entries.filter(isDeliveryEarning).length,
  };
}
