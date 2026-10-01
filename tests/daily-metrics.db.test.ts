/**
 * Statistiques quotidiennes (server/analytics-metrics.ts) contre une vraie base PostgreSQL : la commission du
 * jour est la commission nette de Tikisse, comme au tableau de bord.
 *
 *   TIKISSE_TEST_DATABASE_URL=<url> npx vitest run tests/daily-metrics.db.test.ts
 */
import { beforeAll, describe, expect, it } from "vitest";

const TEST_DB = process.env.TIKISSE_TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

let db: typeof import("../server/db");
let metrics: typeof import("../server/analytics-metrics");
let schema: typeof import("../drizzle/schema");
let orm: typeof import("drizzle-orm");

beforeAll(async () => {
  if (!TEST_DB) return;
  db = await import("../server/db");
  metrics = await import("../server/analytics-metrics");
  schema = await import("../drizzle/schema");
  orm = await import("drizzle-orm");
});

const newPhone = () => `+22677${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;

describe.skipIf(!TEST_DB)("statistiques quotidiennes", () => {
  it("commission du jour = commissions prélevées − commissions rendues ; ni dépôt, ni retrait, ni bonus", async () => {
    // Un jour ancien tiré au hasard : la base de test persiste d'une exécution à l'autre.
    const day = new Date(Date.UTC(1990 + Math.floor(Math.random() * 20), Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 28), 12));
    const date = day.toISOString().slice(0, 10);
    const before = await metrics.computeDailyMetrics(date);
    const phone = newPhone();
    const keys = ["seed", "c1", "c2", "r1", "w1", "b1"].map((suffix) => `${phone}:${suffix}`);
    const handle = (await db.getDb())!;
    await handle.transaction(async (tx) => {
      await db.applyWalletMovement(tx, { profilePhone: phone, operation: "credit", amount: 10_000, availableDelta: 10_000, heldDelta: 0, reason: "Dépôt (test)", idempotencyKey: keys[0]! });
      await db.applyWalletMovement(tx, { profilePhone: phone, operation: "commission_debit", amount: 800, availableDelta: -800, heldDelta: 0, reason: "Commission (test)", idempotencyKey: keys[1]! });
      await db.applyWalletMovement(tx, { profilePhone: phone, operation: "commission_debit", amount: 200, availableDelta: -200, heldDelta: 0, reason: "Commission (test)", idempotencyKey: keys[2]! });
      await db.applyWalletMovement(tx, { profilePhone: phone, operation: "compensation", amount: 300, availableDelta: 300, heldDelta: 0, reason: "Commission rendue (test)", idempotencyKey: keys[3]! });
      await db.applyWalletMovement(tx, { profilePhone: phone, operation: "debit", amount: 1_000, availableDelta: -1_000, heldDelta: 0, reason: "Retrait (test)", idempotencyKey: keys[4]! });
      await db.applyWalletMovement(tx, { profilePhone: phone, operation: "bonus", amount: 500, availableDelta: 500, heldDelta: 0, reason: "Bonus (test)", idempotencyKey: keys[5]! });
    });
    // Le grand livre est immuable (déclencheur) : antidaté sans déclencheurs, le temps d'une transaction de test.
    await handle.transaction(async (tx) => {
      await tx.execute(orm.sql`set local session_replication_role = replica`);
      await tx.update(schema.tikisseWalletLedger).set({ createdAt: day }).where(orm.inArray(schema.tikisseWalletLedger.idempotencyKey, keys));
    });

    const after = await metrics.computeDailyMetrics(date);
    expect(after.commissionTotal - before.commissionTotal).toBe(700);
    expect(after.bonusAwarded - before.bonusAwarded).toBe(500);
    const stored = (await handle.select().from(schema.tikisseDailyMetrics).where(orm.eq(schema.tikisseDailyMetrics.date, date)))[0];
    expect(stored?.commissionTotal).toBe(after.commissionTotal);
  });
});
