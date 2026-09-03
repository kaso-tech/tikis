const FRENCH_MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** Projection 30 jours : averagePerDay × 30. */
export function computeProjection30Days(averagePerDay: number): number {
  return averagePerDay * 30;
}

/** Évolution en % entre deux périodes. null si la période précédente est 0. */
export function computeTrendPct(currentPeriod: number, previousPeriod: number): number | null {
  if (previousPeriod === 0) return null;
  return Math.round(((currentPeriod - previousPeriod) / previousPeriod) * 100);
}

/** Formate une date YYYY-MM-DD en "DD MMM.". Renvoie l'input si invalide. */
export function formatTopDayDate(dateKey: string): string {
  const parts = dateKey.split("-");
  if (parts.length !== 3) return dateKey;
  const year = Number(parts[0]);
  const month = Number(parts[1]) - 1;
  const day = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return dateKey;
  return `${day} ${FRENCH_MONTHS_SHORT[month] ?? ""}`;
}
