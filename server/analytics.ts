/**
 * Analytics personnelles du livreur : la projection de gains affichée sur l'écran Gains.
 *
 * Elle part des MÊMES enregistrements que l'historique de cet écran (`getDriverCompletedDeliveryEarnings`)
 * au lieu de refaire sa propre somme en SQL. C'était le cas jusqu'ici, et les deux calculs divergeaient :
 * la projection additionnait `offeredPrice` brut, commission comprise, et comptait zéro pour toute course
 * publiée sans offre (SUM ignore les NULL, sans repli sur `estimatedPrice`). Le même écran affichait donc,
 * sous l'intitulé « 7 derniers jours », un montant différent de celui de son propre historique.
 *
 * Fonction pure : le routeur lui passe les enregistrements, elle ne touche pas à la base.
 */
import type { FinancialRecord } from "../shared/tikis-domain";
import { computeProjection30Days as project30, computeTrendPct as trendPct } from "./_test-helpers/driver-earnings-projection";

export type DriverEarningsProjection = {
  totalLast7Days: number;
  averagePerDay: number;
  projection30Days: number;
  /** Comparaison avec les 7 jours précédents (%), null si pas d'historique. */
  trendPct: number | null;
  /** Top 5 jours par gains sur les 30 derniers jours. */
  topDays: Array<{ date: string; amount: number }>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeDriverEarningsProjection(
  earnings: ReadonlyArray<Pick<FinancialRecord, "amount" | "createdAt">>,
  now: Date = new Date(),
): DriverEarningsProjection {
  const at = now.getTime();
  const inWindow = (from: number, to: number) =>
    earnings.filter((entry) => {
      const time = new Date(entry.createdAt).getTime();
      return time >= at - from * DAY_MS && time < at - to * DAY_MS;
    });
  const total = (rows: ReadonlyArray<Pick<FinancialRecord, "amount">>) => rows.reduce((sum, entry) => sum + entry.amount, 0);

  const totalLast7 = total(inWindow(7, 0));
  const totalPrev7 = total(inWindow(14, 7));

  // Jour civil UTC — le Burkina Faso vit à UTC+0, et c'est la clé que lisait déjà l'ancienne requête.
  const byDay = new Map<string, number>();
  for (const entry of inWindow(30, 0)) {
    const key = new Date(entry.createdAt).toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + entry.amount);
  }
  const topDays = [...byDay.entries()]
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  const averagePerDay = Math.round(totalLast7 / 7);
  return {
    totalLast7Days: totalLast7,
    averagePerDay,
    projection30Days: project30(averagePerDay),
    trendPct: trendPct(totalLast7, totalPrev7),
    topDays,
  };
}
