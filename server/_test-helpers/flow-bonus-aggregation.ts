type Entry = { id?: string; amount: number; operation: string; createdAt: string };

type Flow = "earnings" | "bonus" | "all";

function isEarning(entry: { operation: string }): boolean {
  return entry.operation === "compensation" || entry.operation === "credit" || entry.operation === "refund";
}

function isBonus(entry: { operation: string }): boolean {
  return entry.operation === "bonus";
}

export function filterEntriesByFlow(entries: Entry[], flow: Flow): Entry[] {
  if (flow === "earnings") return entries.filter(isEarning);
  if (flow === "bonus") return entries.filter(isBonus);
  return entries.filter((entry) => isEarning(entry) || isBonus(entry));
}

export function aggregateBonusAmount(entries: Array<{ amount: number; operation: string }>): number {
  return entries.reduce((sum, entry) => sum + (entry.operation === "bonus" ? entry.amount : 0), 0);
}
