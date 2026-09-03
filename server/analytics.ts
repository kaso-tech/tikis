/**
 * Analytics personnelles du sender — agrégations SQL sur les livraisons terminées.
 *
 * Pas de route Express ni tRPC ici : c'est de la logique pure qui prend un db
 * en paramètre. Les routers tRPC font le glue avec currentTikisProfile.
 */

import { and, count, desc, eq, gte, sql, sum } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { tikisDeliveries, tikisProfiles } from "../drizzle/schema";
import { computeProjection30Days as project30, computeTrendPct as trendPct } from "./_test-helpers/driver-earnings-projection";

type DbHandle = ReturnType<typeof drizzle>;

export type SenderMonthlyBucket = {
  year: number;
  month: number; // 1-12
  label: string; // "Août 2026"
  deliveriesCount: number;
  totalSpent: number;
};

export type SenderDriverPreference = {
  driverPhone: string;
  driverName: string;
  deliveriesCount: number;
  totalSpent: number;
  averageRating: number;
};

export type SenderStats = {
  month: {
    year: number;
    month: number;
    label: string;
    deliveriesCount: number;
    totalSpent: number;
  };
  allTime: {
    deliveriesCount: number;
    totalSpent: number;
    averagePrice: number;
  };
  trend: SenderMonthlyBucket[]; // 6 derniers mois, ordre chronologique
  preferredDrivers: SenderDriverPreference[]; // top 3
};

function monthLabel(date: Date): string {
  return date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

export async function computeSenderStats(db: DbHandle, senderPhone: string, now: Date = new Date()): Promise<SenderStats> {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // 1) Stats du mois en cours
  const monthRows = await db
    .select({ count: count(), total: sum(tikisDeliveries.offeredPrice) })
    .from(tikisDeliveries)
    .where(and(eq(tikisDeliveries.senderPhone, senderPhone), eq(tikisDeliveries.status, "completed"), gte(tikisDeliveries.completedAt, monthStart)));
  const monthCount = Number(monthRows[0]?.count ?? 0);
  const monthTotal = Number(monthRows[0]?.total ?? 0);

  // 2) Stats all-time
  const allTimeRows = await db
    .select({ count: count(), total: sum(tikisDeliveries.offeredPrice), avg: sql<number>`AVG(${tikisDeliveries.offeredPrice})` })
    .from(tikisDeliveries)
    .where(and(eq(tikisDeliveries.senderPhone, senderPhone), eq(tikisDeliveries.status, "completed")));
  const allTimeCount = Number(allTimeRows[0]?.count ?? 0);
  const allTimeTotal = Number(allTimeRows[0]?.total ?? 0);
  const allTimeAvg = Number(allTimeRows[0]?.avg ?? 0);

  // 3) Tendance 6 derniers mois
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const trendRaw = await db
    .select({
      year: sql<number>`YEAR(${tikisDeliveries.completedAt})`,
      month: sql<number>`MONTH(${tikisDeliveries.completedAt})`,
      deliveriesCount: count(),
      totalSpent: sum(tikisDeliveries.offeredPrice),
    })
    .from(tikisDeliveries)
    .where(and(eq(tikisDeliveries.senderPhone, senderPhone), eq(tikisDeliveries.status, "completed"), gte(tikisDeliveries.completedAt, sixMonthsAgo)))
    .groupBy(sql`YEAR(${tikisDeliveries.completedAt})`, sql`MONTH(${tikisDeliveries.completedAt})`)
    .orderBy(sql`YEAR(${tikisDeliveries.completedAt})`, sql`MONTH(${tikisDeliveries.completedAt})`);

  // Comble les mois sans livraison avec 0
  const trend: SenderMonthlyBucket[] = [];
  for (let i = 0; i < 6; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const found = trendRaw.find((row) => Number(row.year) === y && Number(row.month) === m);
    trend.push({
      year: y,
      month: m,
      label: monthLabel(d),
      deliveriesCount: Number(found?.deliveriesCount ?? 0),
      totalSpent: Number(found?.totalSpent ?? 0),
    });
  }

  // 4) Top 3 livreurs
  const driversRaw = await db
    .select({
      driverPhone: tikisDeliveries.driverPhone,
      fullName: tikisProfiles.fullName,
      deliveriesCount: count(),
      totalSpent: sum(tikisDeliveries.offeredPrice),
    })
    .from(tikisDeliveries)
    .innerJoin(tikisProfiles, eq(tikisProfiles.phone, tikisDeliveries.driverPhone))
    .where(and(eq(tikisDeliveries.senderPhone, senderPhone), eq(tikisDeliveries.status, "completed")))
    .groupBy(tikisDeliveries.driverPhone, tikisProfiles.fullName)
    .orderBy(desc(count()), desc(sum(tikisDeliveries.offeredPrice)))
    .limit(3);

  const preferredDrivers: SenderDriverPreference[] = driversRaw.map((row) => ({
    driverPhone: row.driverPhone,
    driverName: row.fullName,
    deliveriesCount: Number(row.deliveriesCount),
    totalSpent: Number(row.totalSpent),
    averageRating: 0, // pourrait être joint à tikisDeliveryReviews plus tard
  }));

  return {
    month: {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      label: monthLabel(monthStart),
      deliveriesCount: monthCount,
      totalSpent: monthTotal,
    },
    allTime: {
      deliveriesCount: allTimeCount,
      totalSpent: allTimeTotal,
      averagePrice: allTimeAvg,
    },
    trend,
    preferredDrivers,
  };
}

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
