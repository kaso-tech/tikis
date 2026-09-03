import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { tikisDailyMetrics } from "../drizzle/schema";
import { getLocalDateString } from "./_test-helpers/date-format";

/** Calcule les métriques d'une journée et les upsert dans tikis_daily_metrics.
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

  const startOfDay = `${date} 00:00:00`;
  const endOfDay = `${date} 23:59:59`;

  const [
    createdRow] = await db.execute<{ count: number }>(sql`SELECT COUNT(*) AS count FROM tikis_deliveries WHERE createdAt BETWEEN ${startOfDay} AND ${endOfDay}`);
  const [completedRow] = await db.execute<{ count: number }>(sql`SELECT COUNT(*) AS count FROM tikis_deliveries WHERE status = 'completed' AND completedAt BETWEEN ${startOfDay} AND ${endOfDay}`);
  const [cancelledRow] = await db.execute<{ count: number }>(sql`SELECT COUNT(*) AS count FROM tikis_deliveries WHERE status = 'cancelled' AND updatedAt BETWEEN ${startOfDay} AND ${endOfDay}`);
  const [gmvRow] = await db.execute<{ total: number }>(sql`SELECT COALESCE(SUM(COALESCE(offeredPrice, estimatedPrice)), 0) AS total FROM tikis_deliveries WHERE status = 'completed' AND completedAt BETWEEN ${startOfDay} AND ${endOfDay}`);
  const [commissionRow] = await db.execute<{ total: number }>(sql`SELECT COALESCE(SUM(amount), 0) AS total FROM tikis_wallet_ledger WHERE operation = 'compensation' AND createdAt BETWEEN ${startOfDay} AND ${endOfDay}`);
  const [newDriversRow] = await db.execute<{ count: number }>(sql`SELECT COUNT(*) AS count FROM tikis_profiles WHERE accountType = 'driver' AND DATE(createdAt) = ${date}`);
  const [newSendersRow] = await db.execute<{ count: number }>(sql`SELECT COUNT(*) AS count FROM tikis_profiles WHERE accountType = 'sender' AND DATE(createdAt) = ${date}`);
  const [activeDriversRow] = await db.execute<{ count: number }>(sql`SELECT COUNT(DISTINCT driverPhone) AS count FROM tikis_deliveries WHERE status = 'completed' AND completedAt BETWEEN ${startOfDay} AND ${endOfDay}`);
  const [activeSendersRow] = await db.execute<{ count: number }>(sql`SELECT COUNT(DISTINCT senderPhone) AS count FROM tikis_deliveries WHERE createdAt BETWEEN ${startOfDay} AND ${endOfDay}`);
  const [bonusRow] = await db.execute<{ total: number }>(sql`SELECT COALESCE(SUM(amount), 0) AS total FROM tikis_wallet_ledger WHERE operation = 'bonus' AND createdAt BETWEEN ${startOfDay} AND ${endOfDay}`);
  const [reportsRow] = await db.execute<{ count: number }>(sql`SELECT COUNT(*) AS count FROM tikis_delivery_reports WHERE createdAt BETWEEN ${startOfDay} AND ${endOfDay}`);

  const metrics = {
    date,
    deliveriesCreated: Number(createdRow[0]?.count ?? 0),
    deliveriesCompleted: Number(completedRow[0]?.count ?? 0),
    deliveriesCancelled: Number(cancelledRow[0]?.count ?? 0),
    gmvTotal: Number(gmvRow[0]?.total ?? 0),
    commissionTotal: Number(commissionRow[0]?.total ?? 0),
    newDrivers: Number(newDriversRow[0]?.count ?? 0),
    newSenders: Number(newSendersRow[0]?.count ?? 0),
    activeDrivers: Number(activeDriversRow[0]?.count ?? 0),
    activeSenders: Number(activeSendersRow[0]?.count ?? 0),
    bonusAwarded: Number(bonusRow[0]?.total ?? 0),
    reportsOpened: Number(reportsRow[0]?.count ?? 0),
  };

  await db.insert(tikisDailyMetrics).values(metrics).onDuplicateKeyUpdate({
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
