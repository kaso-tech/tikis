/**
 * Analytics personnelles du driver — agrégations SQL sur les livraisons terminées.
 *
 * Pas de route Express ni tRPC ici : c'est de la logique pure qui prend un db
 * en paramètre. Les routers tRPC font le glue avec currentTikisProfile.
 */

import { and, count, desc, eq, gte, sql, sum } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { tikisDeliveries } from "../drizzle/schema";
import { computeProjection30Days as project30, computeTrendPct as trendPct } from "./_test-helpers/driver-earnings-projection";

type DbHandle = ReturnType<typeof drizzle>;

/** Projection 30 jours pour un driver : moyenne journalière des gains sur les 7 derniers jours
 *  × 30. Si aucune activité, retourne 0. */
export type DriverEarningsProjection = {
  totalLast7Days: number;
  averagePerDay: number;
  projection30Days: number;
  /** Comparaison avec les 7 jours précédents (%), null si pas d'historique. */
  trendPct: number | null;
  /** Top 5 jours par gains sur les 30 derniers jours. */
  topDays: Array<{ date: string; amount: number }>;
};

export async function computeDriverEarningsProjection(db: DbHandle, driverPhone: string, now: Date = new Date()): Promise<DriverEarningsProjection> {
  const since30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const since7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const since14 = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // Total 7 derniers jours
  const last7Rows = await db
    .select({ total: sum(tikisDeliveries.offeredPrice), count: count() })
    .from(tikisDeliveries)
    .where(and(
      eq(tikisDeliveries.driverPhone, driverPhone),
      eq(tikisDeliveries.status, "completed"),
      gte(tikisDeliveries.completedAt, since7),
    ));
  const totalLast7 = Number(last7Rows[0]?.total ?? 0);

  // Total 7 jours d'avant
  const prev7Rows = await db
    .select({ total: sum(tikisDeliveries.offeredPrice) })
    .from(tikisDeliveries)
    .where(and(
      eq(tikisDeliveries.driverPhone, driverPhone),
      eq(tikisDeliveries.status, "completed"),
      gte(tikisDeliveries.completedAt, since14),
      sql`${tikisDeliveries.completedAt} < ${since7.toISOString()}`,
    ));
  const totalPrev7 = Number(prev7Rows[0]?.total ?? 0);

  // Top 5 jours sur 30 jours
  const topDaysRaw = await db
    .select({
      date: sql<string>`DATE_FORMAT(${tikisDeliveries.completedAt}, '%Y-%m-%d')`,
      amount: sum(tikisDeliveries.offeredPrice),
    })
    .from(tikisDeliveries)
    .where(and(
      eq(tikisDeliveries.driverPhone, driverPhone),
      eq(tikisDeliveries.status, "completed"),
      gte(tikisDeliveries.completedAt, since30),
    ))
    .groupBy(sql`DATE_FORMAT(${tikisDeliveries.completedAt}, '%Y-%m-%d')`)
    .orderBy(desc(sum(tikisDeliveries.offeredPrice)))
    .limit(5);

  const averagePerDay = Math.round(totalLast7 / 7);
  const projection30Days = project30(averagePerDay);
  const trend = trendPct(totalLast7, totalPrev7);

  return {
    totalLast7Days: totalLast7,
    averagePerDay,
    projection30Days,
    trendPct: trend,
    topDays: topDaysRaw.map((row) => ({ date: row.date, amount: Number(row.amount ?? 0) })),
  };
}
