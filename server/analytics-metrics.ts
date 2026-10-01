import { and, count, countDistinct, eq, gte, inArray, lt, sql, type AnyColumn } from "drizzle-orm";
import { getDb } from "./db";
import { tikisseDailyMetrics, tikisseDeliveries, tikisseDeliveryReports, tikisseProfiles, tikisseWalletLedger } from "../drizzle/schema";
import { getLocalDateString } from "./_test-helpers/date-format";

/** Calcule les métriques d'une journée et les upsert dans tikisse_daily_metrics.
 *  Idempotent : peut être appelé plusieurs fois pour la même date.
 *  Renvoie les métriques calculées. */
export async function computeDailyMetrics(date: string): Promise<{
  date: string;
  deliveriesCreated: number;
  deliveriesCompleted: number;
  deliveriesCancelled: number;
  gmvTotal: number;
  commissionTotal: number;
  newDrivers: number;
  newSenders: number;
  activeDrivers: number;
  activeSenders: number;
  bonusAwarded: number;
  reportsOpened: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("La base de données est temporairement indisponible.");

  // Journée du fuseau de la base (UTC chez Supabase), bornes [début, début + 1 jour[ : un
  // `BETWEEN … 23:59:59` laissait de côté la dernière seconde.
  const inDay = (column: AnyColumn) => and(
    gte(column, sql`${date}::date`),
    lt(column, sql`${date}::date + interval '1 day'`),
  );
  const first = async <T extends Record<string, unknown>>(rows: Promise<T[]>) => (await rows)[0] ?? ({} as Partial<T>);
  const total = (expression: ReturnType<typeof sql>) => sql<number>`coalesce(sum(${expression}), 0)`.mapWith(Number);

  const [createdRow, completedRow, cancelledRow, gmvRow, commissionRow, newDriversRow, newSendersRow, activeDriversRow, activeSendersRow, bonusRow, reportsRow] = await Promise.all([
    first(db.select({ count: count() }).from(tikisseDeliveries).where(inDay(tikisseDeliveries.createdAt))),
    first(db.select({ count: count() }).from(tikisseDeliveries).where(and(eq(tikisseDeliveries.status, "completed"), inDay(tikisseDeliveries.completedAt)))),
    first(db.select({ count: count() }).from(tikisseDeliveries).where(and(eq(tikisseDeliveries.status, "cancelled"), inDay(tikisseDeliveries.updatedAt)))),
    first(db.select({ total: total(sql`coalesce(${tikisseDeliveries.offeredPrice}, ${tikisseDeliveries.estimatedPrice})`) }).from(tikisseDeliveries).where(and(eq(tikisseDeliveries.status, "completed"), inDay(tikisseDeliveries.completedAt)))),
    // Commission nette de Tikisse, comme au tableau de bord (server/admin-db.ts) : commissions prélevées
    // (`commission_debit`) moins commissions rendues (`compensation` : livreur remplacé, course expirée ou
    // annulée, litige). Ce total additionnait auparavant les seules commissions rendues — l'inverse d'un revenu.
    first(db.select({
      total: sql<number>`coalesce(sum(case when ${tikisseWalletLedger.operation} = 'commission_debit' then ${tikisseWalletLedger.amount} else -${tikisseWalletLedger.amount} end), 0)`.mapWith(Number),
    }).from(tikisseWalletLedger).where(and(inArray(tikisseWalletLedger.operation, ["commission_debit", "compensation"]), inDay(tikisseWalletLedger.createdAt)))),
    first(db.select({ count: count() }).from(tikisseProfiles).where(and(eq(tikisseProfiles.accountType, "driver"), inDay(tikisseProfiles.createdAt)))),
    first(db.select({ count: count() }).from(tikisseProfiles).where(and(eq(tikisseProfiles.accountType, "sender"), inDay(tikisseProfiles.createdAt)))),
    first(db.select({ count: countDistinct(tikisseDeliveries.driverPhone) }).from(tikisseDeliveries).where(and(eq(tikisseDeliveries.status, "completed"), inDay(tikisseDeliveries.completedAt)))),
    first(db.select({ count: countDistinct(tikisseDeliveries.senderPhone) }).from(tikisseDeliveries).where(inDay(tikisseDeliveries.createdAt))),
    first(db.select({ total: total(sql`${tikisseWalletLedger.amount}`) }).from(tikisseWalletLedger).where(and(eq(tikisseWalletLedger.operation, "bonus"), inDay(tikisseWalletLedger.createdAt)))),
    first(db.select({ count: count() }).from(tikisseDeliveryReports).where(inDay(tikisseDeliveryReports.createdAt))),
  ]);

  const metrics = {
    date,
    deliveriesCreated: Number(createdRow.count ?? 0),
    deliveriesCompleted: Number(completedRow.count ?? 0),
    deliveriesCancelled: Number(cancelledRow.count ?? 0),
    gmvTotal: Number(gmvRow.total ?? 0),
    commissionTotal: Number(commissionRow.total ?? 0),
    newDrivers: Number(newDriversRow.count ?? 0),
    newSenders: Number(newSendersRow.count ?? 0),
    activeDrivers: Number(activeDriversRow.count ?? 0),
    activeSenders: Number(activeSendersRow.count ?? 0),
    bonusAwarded: Number(bonusRow.total ?? 0),
    reportsOpened: Number(reportsRow.count ?? 0),
  };

  await db.insert(tikisseDailyMetrics).values(metrics).onConflictDoUpdate({ target: tikisseDailyMetrics.date,
    set: {
      deliveriesCreated: metrics.deliveriesCreated,
      deliveriesCompleted: metrics.deliveriesCompleted,
      deliveriesCancelled: metrics.deliveriesCancelled,
      gmvTotal: metrics.gmvTotal,
      commissionTotal: metrics.commissionTotal,
      newDrivers: metrics.newDrivers,
      newSenders: metrics.newSenders,
      activeDrivers: metrics.activeDrivers,
      activeSenders: metrics.activeSenders,
      bonusAwarded: metrics.bonusAwarded,
      reportsOpened: metrics.reportsOpened,
      computedAt: new Date(),
    },
  });

  return metrics;
}

/** Calcule les métriques des N derniers jours (par défaut, hier inclus). */
export async function computeRecentMetrics(days: number): Promise<Array<{ date: string; gmvTotal: number; commissionTotal: number; deliveriesCompleted: number }>> {
  const today = new Date();
  const result: Array<{ date: string; gmvTotal: number; commissionTotal: number; deliveriesCompleted: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const target = new Date(today);
    target.setDate(target.getDate() - i);
    const date = getLocalDateString(target);
    const metrics = await computeDailyMetrics(date);
    result.push({ date, gmvTotal: metrics.gmvTotal, commissionTotal: metrics.commissionTotal, deliveriesCompleted: metrics.deliveriesCompleted });
  }
  return result;
}
