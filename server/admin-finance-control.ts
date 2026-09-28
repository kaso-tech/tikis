/**
 * Contrôle financier de la console : ce qu'il faut surveiller chaque jour pour que l'argent de
 * l'application reste juste.
 *
 *  - journal des webhooks YengaPay (reçus, traités, en échec, ignorés) ;
 *  - anomalies : dépôts restés en attente, écarts entre le montant attendu et celui annoncé par YengaPay,
 *    webhooks en échec ou jamais traités ;
 *  - Wallets : totaux, et contrôle que chaque solde est exactement la somme de ses mouvements ;
 *  - export comptable d'un mois.
 */
import { and, asc, count, desc, eq, gte, isNotNull, like, lt, ne, or, sql } from "drizzle-orm";
import { tikisPaymentTransactions, tikisWalletLedger, tikisWallets, tikisYengapayWebhookEvents } from "../drizzle/schema";
import { getDb } from "./db";

/** Neutralise les jokers de LIKE : une recherche « 100% » cherche ce texte, pas « 100 suivi de n'importe quoi ». */
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export type WebhookEventStatus = "received" | "processed" | "failed" | "ignored";

/**
 * Webhooks YengaPay, les plus récents d'abord. `query` retrouve un événement par son identifiant interne,
 * par l'identifiant YengaPay de l'événement (enregistré sous la forme « identifiant:type »), par la
 * transaction Tikis liée, ou — à partir de 8 caractères — par toute référence présente dans le contenu
 * reçu (référence de paiement YengaPay notamment).
 */
export async function adminListWebhookEvents(input: { status?: WebhookEventStatus; query?: string; limit?: number; offset?: number }) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  const query = input.query?.trim();
  const where = and(
    input.status ? eq(tikisYengapayWebhookEvents.status, input.status) : undefined,
    query ? or(
      eq(tikisYengapayWebhookEvents.id, query),
      eq(tikisYengapayWebhookEvents.providerEventId, query),
      like(tikisYengapayWebhookEvents.providerEventId, `${escapeLike(query)}:%`),
      eq(tikisYengapayWebhookEvents.paymentTransactionId, query),
      ...(query.length >= 8 ? [like(tikisYengapayWebhookEvents.payload, `%${escapeLike(query)}%`)] : []),
    ) : undefined,
  );
  const limit = Math.min(input.limit ?? 50, 200);
  const [rows, total] = await Promise.all([
    dbc.select({
      id: tikisYengapayWebhookEvents.id, provider: tikisYengapayWebhookEvents.provider, providerEventId: tikisYengapayWebhookEvents.providerEventId,
      eventType: tikisYengapayWebhookEvents.eventType, paymentTransactionId: tikisYengapayWebhookEvents.paymentTransactionId, status: tikisYengapayWebhookEvents.status,
      failureReason: tikisYengapayWebhookEvents.failureReason, createdAt: tikisYengapayWebhookEvents.createdAt, processedAt: tikisYengapayWebhookEvents.processedAt,
      // Aperçu seulement : le contenu complet peut être long, et il n'est utile qu'en cas d'enquête.
      payloadPreview: sql<string>`left(${tikisYengapayWebhookEvents.payload}, 400)`,
    }).from(tikisYengapayWebhookEvents).where(where).orderBy(desc(tikisYengapayWebhookEvents.createdAt)).limit(limit).offset(Math.max(input.offset ?? 0, 0)),
    dbc.select({ count: count() }).from(tikisYengapayWebhookEvents).where(where),
  ]);
  return { rows, total: Number(total[0]?.count ?? 0) };
}

export const STALE_PENDING_DEPOSIT_MINUTES = 30;
/** Un webhook reçu mais jamais clos au bout de ce délai s'est arrêté en route (redémarrage, panne). */
export const STUCK_WEBHOOK_MINUTES = 10;

export async function adminPaymentAnomalies(now = new Date()) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  const staleBefore = new Date(now.getTime() - STALE_PENDING_DEPOSIT_MINUTES * 60_000);
  const stuckBefore = new Date(now.getTime() - STUCK_WEBHOOK_MINUTES * 60_000);
  const stalePending = and(eq(tikisPaymentTransactions.type, "deposit"), eq(tikisPaymentTransactions.status, "pending"), lt(tikisPaymentTransactions.createdAt, staleBefore));
  const mismatch = and(isNotNull(tikisPaymentTransactions.providerReportedAmount), ne(tikisPaymentTransactions.providerReportedAmount, tikisPaymentTransactions.amount));
  const webhookProblem = or(
    eq(tikisYengapayWebhookEvents.status, "failed"),
    and(eq(tikisYengapayWebhookEvents.status, "received"), lt(tikisYengapayWebhookEvents.createdAt, stuckBefore)),
  );
  const [pendingRows, pendingCount, mismatchRows, mismatchCount, webhookCount] = await Promise.all([
    dbc.select().from(tikisPaymentTransactions).where(stalePending).orderBy(asc(tikisPaymentTransactions.createdAt)).limit(100),
    dbc.select({ count: count() }).from(tikisPaymentTransactions).where(stalePending),
    dbc.select().from(tikisPaymentTransactions).where(mismatch).orderBy(desc(tikisPaymentTransactions.settledAt)).limit(100),
    dbc.select({ count: count() }).from(tikisPaymentTransactions).where(mismatch),
    dbc.select({ count: count() }).from(tikisYengapayWebhookEvents).where(webhookProblem),
  ]);
  return {
    stalePendingDeposits: { rows: pendingRows, total: Number(pendingCount[0]?.count ?? 0) },
    amountMismatches: { rows: mismatchRows, total: Number(mismatchCount[0]?.count ?? 0) },
    webhookProblems: Number(webhookCount[0]?.count ?? 0),
  };
}

/**
 * Totaux des Wallets, et contrôle de cohérence : chaque mouvement du grand livre enregistre les soldes
 * avant et après, donc la somme des écarts d'un profil doit donner exactement son solde actuel —
 * disponible comme bloqué. Un Wallet qui s'en écarte a été modifié hors du grand livre (correction
 * manuelle en base, bug) : c'est ce que ce contrôle révèle. Les soldes négatifs sont signalés aussi.
 */
export async function adminWalletCheck() {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  const totals = (await dbc.select({
    wallets: count(),
    available: sql<number>`coalesce(sum(${tikisWallets.availableBalance}), 0)`,
    held: sql<number>`coalesce(sum(${tikisWallets.heldBalance}), 0)`,
  }).from(tikisWallets))[0];
  const ledgerAvailable = sql<number>`coalesce(sum(${tikisWalletLedger.availableAfter} - ${tikisWalletLedger.availableBefore}), 0)`;
  const ledgerHeld = sql<number>`coalesce(sum(${tikisWalletLedger.heldAfter} - ${tikisWalletLedger.heldBefore}), 0)`;
  const discrepancies = await dbc.select({
    profilePhone: tikisWallets.profilePhone,
    availableBalance: tikisWallets.availableBalance,
    heldBalance: tikisWallets.heldBalance,
    ledgerAvailable,
    ledgerHeld,
  }).from(tikisWallets)
    .leftJoin(tikisWalletLedger, eq(tikisWalletLedger.profilePhone, tikisWallets.profilePhone))
    .groupBy(tikisWallets.profilePhone, tikisWallets.availableBalance, tikisWallets.heldBalance)
    .having(sql`${tikisWallets.availableBalance} <> ${ledgerAvailable} or ${tikisWallets.heldBalance} <> ${ledgerHeld} or ${tikisWallets.availableBalance} < 0 or ${tikisWallets.heldBalance} < 0`)
    .limit(200);
  return {
    wallets: Number(totals?.wallets ?? 0),
    available: Number(totals?.available ?? 0),
    held: Number(totals?.held ?? 0),
    discrepancies: discrepancies.map((row) => ({ ...row, ledgerAvailable: Number(row.ledgerAvailable), ledgerHeld: Number(row.ledgerHeld) })),
    checkedAt: new Date().toISOString(),
  };
}

export const ACCOUNTING_EXPORT_MAX_ROWS = 50_000;

/** Début et fin (exclue) d'un mois « AAAA-MM », en UTC — l'heure du Burkina Faso. */
export function monthRange(month: string) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new Error("Mois invalide : format attendu AAAA-MM.");
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  return { start: new Date(Date.UTC(year, index, 1)), end: new Date(Date.UTC(year, index + 1, 1)) };
}

/**
 * Relevé comptable d'un mois : totaux par type de mouvement du grand livre, paiements YengaPay réglés
 * (par date de règlement), commissions nettes, et le détail des mouvements pour l'export CSV.
 */
export async function adminAccountingMonth(month: string) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  const { start, end } = monthRange(month);
  const inMonth = and(gte(tikisWalletLedger.createdAt, start), lt(tikisWalletLedger.createdAt, end));
  const settledInMonth = and(eq(tikisPaymentTransactions.status, "succeeded"), gte(tikisPaymentTransactions.settledAt, start), lt(tikisPaymentTransactions.settledAt, end));
  const [operations, payments, rows] = await Promise.all([
    dbc.select({ operation: tikisWalletLedger.operation, movements: count(), total: sql<number>`coalesce(sum(${tikisWalletLedger.amount}), 0)` })
      .from(tikisWalletLedger).where(inMonth).groupBy(tikisWalletLedger.operation),
    dbc.select({ type: tikisPaymentTransactions.type, transactions: count(), total: sql<number>`coalesce(sum(${tikisPaymentTransactions.amount}), 0)` })
      .from(tikisPaymentTransactions).where(settledInMonth).groupBy(tikisPaymentTransactions.type),
    dbc.select({
      createdAt: tikisWalletLedger.createdAt, profilePhone: tikisWalletLedger.profilePhone, operation: tikisWalletLedger.operation, amount: tikisWalletLedger.amount,
      availableBefore: tikisWalletLedger.availableBefore, availableAfter: tikisWalletLedger.availableAfter, heldBefore: tikisWalletLedger.heldBefore, heldAfter: tikisWalletLedger.heldAfter,
      deliveryId: tikisWalletLedger.deliveryId, reason: tikisWalletLedger.reason, id: tikisWalletLedger.id,
    }).from(tikisWalletLedger).where(inMonth).orderBy(asc(tikisWalletLedger.createdAt), asc(tikisWalletLedger.id)).limit(ACCOUNTING_EXPORT_MAX_ROWS + 1),
  ]);
  const byOperation = Object.fromEntries(operations.map((row) => [row.operation, { movements: Number(row.movements), total: Number(row.total) }]));
  const byType = Object.fromEntries(payments.map((row) => [row.type, { transactions: Number(row.transactions), total: Number(row.total) }]));
  const commissionGross = byOperation.commission_debit?.total ?? 0;
  const commissionRefunds = byOperation.compensation?.total ?? 0;
  return {
    month,
    period: { start: start.toISOString(), end: end.toISOString() },
    operations: operations.map((row) => ({ operation: row.operation, movements: Number(row.movements), total: Number(row.total) })).sort((a, b) => a.operation.localeCompare(b.operation)),
    deposits: byType.deposit ?? { transactions: 0, total: 0 },
    withdrawals: byType.withdrawal ?? { transactions: 0, total: 0 },
    commissions: { gross: commissionGross, refunds: commissionRefunds, net: commissionGross - commissionRefunds },
    bonuses: byOperation.bonus?.total ?? 0,
    penalties: byOperation.penalty?.total ?? 0,
    rows: rows.slice(0, ACCOUNTING_EXPORT_MAX_ROWS).map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    truncated: rows.length > ACCOUNTING_EXPORT_MAX_ROWS,
  };
}
