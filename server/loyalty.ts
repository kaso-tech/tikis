/**
 * Programme de fidélité — évaluation des bonus.
 *
 * Pour chaque programme actif ciblant un rôle (sender/driver), on vérifie
 * qu'un profil a atteint le seuil de livraisons terminées dans la fenêtre.
 * Si oui, on insère un grant (idempotent via programId+deliveryId).
 * Le grant est marqué 'pending' puis crédité sur le wallet par un admin
 * (ou un cron si on choisit l'auto-credit plus tard).
 */

import { and, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "./db";
import { tikisDeliveries, tikisLoyaltyGrants, tikisLoyaltyPrograms } from "../drizzle/schema";
import { computeSessionExpiry } from "./_test-helpers/session-revocation";
import { shouldAutoCredit } from "./_test-helpers/loyalty-auto-credit";

export type LoyaltyProgress = {
  program: typeof tikisLoyaltyPrograms.$inferSelect;
  completedCount: number;
  alreadyGranted: boolean;
  /** true si la livraison qui vient d'être complétée déclenche le bonus. */
  justQualified: boolean;
};

export async function listActiveLoyaltyPrograms(role: "sender" | "driver") {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tikisLoyaltyPrograms).where(and(eq(tikisLoyaltyPrograms.role, role), eq(tikisLoyaltyPrograms.enabled, true)));
}

export async function computeLoyaltyProgress(input: { profilePhone: string; role: "sender" | "driver"; completedDeliveryId?: string }) {
  const programs = await listActiveLoyaltyPrograms(input.role);
  const results: LoyaltyProgress[] = [];
  for (const program of programs) {
    const since = new Date(Date.now() - program.windowDays * 24 * 60 * 60 * 1000);
    const phoneColumn = input.role === "sender" ? tikisDeliveries.senderPhone : tikisDeliveries.driverPhone;
    const where = and(eq(phoneColumn, input.profilePhone), eq(tikisDeliveries.status, "completed"), gte(tikisDeliveries.completedAt, since));
    const db = await getDb();
    if (!db) continue;
    const [{ completedCount }] = await db.select({ completedCount: count() }).from(tikisDeliveries).where(where);
    const completedNumber = Number(completedCount);
    const alreadyGrantedRows = input.completedDeliveryId
      ? await db.select().from(tikisLoyaltyGrants).where(and(eq(tikisLoyaltyGrants.programId, program.id), eq(tikisLoyaltyGrants.deliveryId, input.completedDeliveryId))).limit(1)
      : [];
    const alreadyGranted = alreadyGrantedRows.length > 0;
    const justQualified = Boolean(input.completedDeliveryId) && !alreadyGranted && completedNumber === program.requiredDeliveries;
    results.push({ program, completedCount: completedNumber, alreadyGranted, justQualified });
  }
  return results;
}

/** Tente d'octroyer un grant pour un programme et une livraison donnée.
 *  Idempotent : si (programId, deliveryId) existe déjà, retourne l'existant. */
export async function grantLoyaltyBonus(input: { programId: string; profilePhone: string; deliveryId: string }) {
  const db = await getDb();
  if (!db) throw new Error("Le programme de fidélité est temporairement indisponible.");
  const existing = (await db.select().from(tikisLoyaltyGrants).where(and(eq(tikisLoyaltyGrants.programId, input.programId), eq(tikisLoyaltyGrants.deliveryId, input.deliveryId))).limit(1))[0];
  if (existing) return { grant: existing, created: false };
  const programs = await db.select().from(tikisLoyaltyPrograms).where(eq(tikisLoyaltyPrograms.id, input.programId)).limit(1);
  const program = programs[0];
  if (!program) throw new Error("Programme de fidélité introuvable.");
  if (!program.enabled) throw new Error("Programme désactivé.");
  const { randomUUID } = await import("node:crypto");
  const id = randomUUID();
  await db.insert(tikisLoyaltyGrants).values({ id, programId: program.id, profilePhone: input.profilePhone, deliveryId: input.deliveryId, bonusAmount: program.bonusAmount, status: "pending" });
  const created = (await db.select().from(tikisLoyaltyGrants).where(eq(tikisLoyaltyGrants.id, id)).limit(1))[0];
  return { grant: created!, created: true };
}

export async function listPendingLoyaltyGrants(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tikisLoyaltyGrants).where(eq(tikisLoyaltyGrants.status, "pending")).orderBy(desc(tikisLoyaltyGrants.grantedAt)).limit(Math.min(limit, 200));
}

/** Appelé depuis completeTikisDeliveryWithEvents (et tout autre statut terminal).
 *  Pour chaque programme actif ciblant le rôle du phone, on compte les livraisons
 *  terminées dans la fenêtre, on compare au seuil, et on insère un grant si
 *  (a) le compte vient de franchir le seuil, (b) aucun grant n'a déjà été créé
 *  pour (programme, deliveryId) — idempotent.
 *
 *  Renvoie la liste des grants créés (vide si rien à signaler). */
export async function evaluateLoyaltyGrantsForCompletedDelivery(input: { deliveryId: string; profilePhone: string; role: "sender" | "driver" }) {
  const db = await getDb();
  if (!db) return { created: [] as Array<{ programId: string; bonusAmount: number; grantId: string }> };
  const programs = await db.select().from(tikisLoyaltyPrograms).where(and(eq(tikisLoyaltyPrograms.role, input.role), eq(tikisLoyaltyPrograms.enabled, true)));
  const created: Array<{ programId: string; bonusAmount: number; grantId: string }> = [];
  for (const program of programs) {
    const since = new Date(Date.now() - program.windowDays * 24 * 60 * 60 * 1000);
    const phoneColumn = input.role === "sender" ? tikisDeliveries.senderPhone : tikisDeliveries.driverPhone;
    const { count: total } = (await db.select({ count: sql<number>`COUNT(*)` }).from(tikisDeliveries).where(and(
      eq(phoneColumn, input.profilePhone),
      eq(tikisDeliveries.status, "completed"),
      gte(tikisDeliveries.completedAt, since),
    )))[0] ?? { count: 0 };
    const completedCount = Number(total);
    // Le grant se déclenche UNIQUEMENT quand la livraison qui vient d'être complétée
    // fait franchir exactement le seuil. On n'octroie pas rétroactivement.
    if (completedCount !== program.requiredDeliveries) continue;
    // Idempotence : si un grant existe déjà pour (programme, deliveryId), on skip.
    const existing = (await db.select().from(tikisLoyaltyGrants).where(and(eq(tikisLoyaltyGrants.programId, program.id), eq(tikisLoyaltyGrants.deliveryId, input.deliveryId))).limit(1))[0];
    if (existing) continue;
    const { randomUUID } = await import("node:crypto");
    const grantId = randomUUID();
    const expiresAt = computeSessionExpiry(new Date());
    try {
      await db.insert(tikisLoyaltyGrants).values({
        id: grantId,
        programId: program.id,
        profilePhone: input.profilePhone,
        deliveryId: input.deliveryId,
        bonusAmount: program.bonusAmount,
        status: "pending",
        expiresAt,
      });
      created.push({ programId: program.id, bonusAmount: program.bonusAmount, grantId });
    } catch (cause) {
      // Si une race crée un doublon (programId+deliveryId unique), on ignore.
      const message = cause instanceof Error ? cause.message : String(cause);
      if (!message.includes("Duplicate")) {
        throw cause;
      }
    }
  }
  return { created };
}

/** Wrapper appelé par completeTikisDeliveryWithEvents. Évalue les programmes actifs
 *  ciblant le driver ET le sender, crée les grants éventuels, envoie un push
 *  notification best-effort au bénéficiaire. */
export async function evaluateAndNotifyLoyaltyGrants(input: { deliveryId: string; driverPhone: string; senderPhone: string }) {
  const created: Array<{ profilePhone: string; role: "sender" | "driver"; grantId: string; programId: string; bonusAmount: number; autoCredited: boolean }> = [];
  const driverResult = await evaluateLoyaltyGrantsForCompletedDelivery({ deliveryId: input.deliveryId, profilePhone: input.driverPhone, role: "driver" });
  for (const g of driverResult.created) {
    const autoCredited = await maybeAutoCreditGrant(g.grantId, g.programId, g.bonusAmount);
    created.push({ profilePhone: input.driverPhone, role: "driver", grantId: g.grantId, programId: g.programId, bonusAmount: g.bonusAmount, autoCredited });
  }
  const senderResult = await evaluateLoyaltyGrantsForCompletedDelivery({ deliveryId: input.deliveryId, profilePhone: input.senderPhone, role: "sender" });
  for (const g of senderResult.created) {
    const autoCredited = await maybeAutoCreditGrant(g.grantId, g.programId, g.bonusAmount);
    created.push({ profilePhone: input.senderPhone, role: "sender", grantId: g.grantId, programId: g.programId, bonusAmount: g.bonusAmount, autoCredited });
  }
  await enqueueLoyaltyGrantNotification(created);
  return { created };
}

/** Si le programme a l'auto-crédit activé, crédite immédiatement le wallet.
 *  Renvoie true si le grant a été crédité automatiquement, false sinon. */
async function maybeAutoCreditGrant(grantId: string, programId: string, bonusAmount: number): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;
    const program = (await db.select().from(tikisLoyaltyPrograms).where(eq(tikisLoyaltyPrograms.id, programId)).limit(1))[0];
    if (!program || !shouldAutoCredit(program)) return false;
    await creditLoyaltyGrantOnWallet(grantId);
    return true;
  } catch (cause) {
    return false;
  }
}

/** Envoie un push notification pour chaque grant créé. Best-effort. */
export async function enqueueLoyaltyGrantNotification(grants: Array<{ profilePhone: string; grantId: string; programId: string; bonusAmount: number }>) {
  if (grants.length === 0) return;
  const { enqueuePushToPhone } = await import("./db");
  for (const g of grants) {
    try {
      await enqueuePushToPhone({
        phone: g.profilePhone,
        title: "🎁 Bonus de fidélité disponible",
        body: `Vous avez atteint un palier ! ${g.bonusAmount.toLocaleString("fr-FR")} FCFA vous attendent dans l'admin.`,
        data: { grantId: g.grantId, programId: g.programId, kind: "loyalty_grant" },
        channelId: "tikis-loyalty",
      });
    } catch {
      // best-effort, on ne fait pas échouer
    }
  }
}

/** Annule les grants 'pending' dont expiresAt < now. Renvoie le nombre de grants annulés. */
export async function expireLoyaltyGrants(now: Date = new Date()): Promise<{ cancelled: number; ids: string[] }> {
  const db = await getDb();
  if (!db) return { cancelled: 0, ids: [] };
  const cutoff = now;
  const candidates = await db
    .select({ id: tikisLoyaltyGrants.id })
    .from(tikisLoyaltyGrants)
    .where(and(eq(tikisLoyaltyGrants.status, "pending"), lte(tikisLoyaltyGrants.expiresAt, cutoff)));
  if (candidates.length === 0) return { cancelled: 0, ids: [] };
  const ids = candidates.map((c) => c.id);
  for (const id of ids) {
    await db
      .update(tikisLoyaltyGrants)
      .set({ status: "cancelled", cancelledReason: "Expiré après 30 jours sans validation." })
      .where(eq(tikisLoyaltyGrants.id, id));
  }
  return { cancelled: ids.length, ids };
}

/** Crédite un grant sur le wallet du profil de manière transactionnelle.
 *  Idempotent : si le grant est déjà credited, no-op.
 *  Renvoie { credited: boolean, wallet } où wallet est le snapshot final. */
export async function creditLoyaltyGrantOnWallet(grantId: string): Promise<{ credited: boolean; wallet: Awaited<ReturnType<typeof import("./db").ensureTikisWallet>> }> {
  const db = await getDb();
  if (!db) throw new Error("Le Wallet est temporairement indisponible.");
  return db.transaction(async (tx) => {
    const grant = (await tx.select().from(tikisLoyaltyGrants).where(eq(tikisLoyaltyGrants.id, grantId)).limit(1).for("update"))[0];
    if (!grant) throw new Error("Octroi de bonus introuvable.");
    if (grant.status !== "pending") {
      const wallet = await import("./db").then((m) => m.ensureTikisWallet(tx, grant.profilePhone));
      return { credited: false, wallet };
    }
    const wallet = await import("./db").then((m) =>
      m.applyWalletMovement(tx, {
        profilePhone: grant.profilePhone,
        operation: "bonus",
        amount: grant.bonusAmount,
        availableDelta: grant.bonusAmount,
        heldDelta: 0,
        reason: `Bonus fidélité auto-crédit (programme ${grant.programId})`,
        idempotencyKey: `loyalty-grant:${grant.id}`,
      }),
    );
    await tx.update(tikisLoyaltyGrants).set({ status: "credited", creditedAt: new Date(), ledgerEntryId: wallet.idempotencyKey }).where(eq(tikisLoyaltyGrants.id, grant.id));
    return { credited: true, wallet };
  });
}

/** Vérifie si un programme doit auto-créditer ses grants (autoCredit=true et bonus <= seuil). */
export function shouldAutoCredit(program: { autoCredit: boolean; autoCreditMaxAmount: number; bonusAmount: number }): boolean {
  if (!program.autoCredit) return false;
  if (program.autoCreditMaxAmount <= 0) return true; // autoCredit activé sans seuil = tout
  return program.bonusAmount <= program.autoCreditMaxAmount;
}
