/**
 * Suppression des comptes à la demande de l'utilisateur.
 *
 * Politique retenue :
 *  - 30 jours de délai après la demande (l'utilisateur peut annuler) ;
 *  - la suppression définitive attend tant qu'il reste de l'argent (solde à verser, commission réservée,
 *    paiement en cours) ou une livraison en cours : l'équipe règle, puis la suppression se fait ;
 *  - à la suppression, les données personnelles sont effacées (nom, e-mail, photo, adresses favorites,
 *    appareils, préférences, notes internes) et les photos de la pièce d'identité sont effacées du stockage ;
 *    la décision de vérification (date, statut, admin) reste ;
 *  - l'historique financier et des livraisons est gardé 10 ans (pièces comptables, OHADA). Le numéro y est
 *    remplacé tout de suite par un pseudonyme, et libéré pour une nouvelle inscription ; la correspondance
 *    numéro ↔ pseudonyme est gardée à part 10 ans, puis effacée.
 *
 * Le journal d'audit de la console n'est pas réécrit : c'est la trace des décisions de l'équipe.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { and, count, desc, eq, getTableColumns, inArray, is, isNotNull, isNull, like, lt, lte, or, sql } from "drizzle-orm";
import { MySqlTable, getTableConfig } from "drizzle-orm/mysql-core";
import * as schema from "../drizzle/schema";
import {
  tikisAdminApprovals, tikisDeletedAccounts, tikisDeliveries, tikisDeliveryEvents, tikisDeliveryLiveLocations, tikisDriverPreferences, tikisFavoritePlaces,
  tikisKycSubmissions, tikisPaymentTransactions, tikisProfileNotes, tikisProfileSessions, tikisProfiles, tikisPushTokens, tikisRateLimits, tikisStorageErasures,
  tikisWalletLedger, tikisWallets,
} from "../drizzle/schema";
import * as approvals from "./admin-approvals";
import { invalidateTikisProfileCache } from "./_core/profile-cache";
import * as db from "./db";
import { storageErase } from "./storage";

export const FINANCIAL_RETENTION_YEARS = 10;
const ERASURE_MAX_ATTEMPTS = 10;

type Tx = Parameters<Parameters<NonNullable<Awaited<ReturnType<typeof db.getDb>>>["transaction"]>[0]>[0];
type Handle = Tx | NonNullable<Awaited<ReturnType<typeof db.getDb>>>;

async function database() {
  const handle = await db.getDb();
  if (!handle) throw new Error("La console d’administration est temporairement indisponible.");
  return handle;
}

function formatMoney(amount: number) {
  return `${amount.toLocaleString("fr-FR")} FCFA`;
}

export type DeletionBlocker = { code: "balance" | "held" | "delivery" | "payment" | "approval"; label: string };

/** Ce qui empêche encore de supprimer ce compte sans perdre d'argent ou laisser une course en plan. */
export async function deletionBlockers(handle: Handle, phone: string): Promise<DeletionBlocker[]> {
  const [wallet, deliveries, payments, openApprovals] = await Promise.all([
    handle.select().from(tikisWallets).where(eq(tikisWallets.profilePhone, phone)).limit(1),
    handle.select({ count: count() }).from(tikisDeliveries).where(and(or(eq(tikisDeliveries.senderPhone, phone), eq(tikisDeliveries.driverPhone, phone)), inArray(tikisDeliveries.status, ["open", "pending_confirmation", "active"]))),
    handle.select({ count: count() }).from(tikisPaymentTransactions).where(and(eq(tikisPaymentTransactions.profilePhone, phone), eq(tikisPaymentTransactions.status, "pending"))),
    handle.select({ count: count() }).from(tikisAdminApprovals).where(and(eq(tikisAdminApprovals.targetPhone, phone), inArray(tikisAdminApprovals.status, ["pending", "approved"]))),
  ]);
  const blockers: DeletionBlocker[] = [];
  const available = wallet[0]?.availableBalance ?? 0;
  const held = wallet[0]?.heldBalance ?? 0;
  if (available > 0) blockers.push({ code: "balance", label: `Solde de ${formatMoney(available)} à verser` });
  if (held > 0) blockers.push({ code: "held", label: `${formatMoney(held)} réservés sur des candidatures en cours` });
  const activeDeliveries = Number(deliveries[0]?.count ?? 0);
  if (activeDeliveries > 0) blockers.push({ code: "delivery", label: `${activeDeliveries} livraison(s) en cours` });
  const pendingPayments = Number(payments[0]?.count ?? 0);
  if (pendingPayments > 0) blockers.push({ code: "payment", label: `${pendingPayments} paiement(s) en attente` });
  const pendingApprovals = Number(openApprovals[0]?.count ?? 0);
  if (pendingApprovals > 0) blockers.push({ code: "approval", label: `${pendingApprovals} opération(s) en attente de validation` });
  return blockers;
}

export class DeletionBlockedError extends Error {
  constructor(readonly blockers: DeletionBlocker[]) {
    super(`Suppression impossible pour l’instant : ${blockers.map((blocker) => blocker.label).join(" ; ")}.`);
  }
}

/** Demandes en cours : dans le délai, à traiter (bloquées), ou prêtes à être finalisées. */
export async function listDeletionRequests(now = new Date()) {
  const handle = await database();
  const rows = await handle.select().from(tikisProfiles).where(and(isNotNull(tikisProfiles.deletionRequestedAt), isNull(tikisProfiles.deletedAt))).orderBy(tikisProfiles.deletionScheduledAt).limit(200);
  const requests = await Promise.all(rows.map(async (profile) => {
    const [blockers, wallet] = await Promise.all([deletionBlockers(handle, profile.phone), handle.select().from(tikisWallets).where(eq(tikisWallets.profilePhone, profile.phone)).limit(1)]);
    const due = !profile.deletionScheduledAt || profile.deletionScheduledAt <= now;
    return {
      phone: profile.phone, fullName: profile.fullName, accountType: profile.accountType, status: profile.status,
      deletionRequestedAt: profile.deletionRequestedAt, deletionScheduledAt: profile.deletionScheduledAt,
      available: wallet[0]?.availableBalance ?? 0, held: wallet[0]?.heldBalance ?? 0, blockers,
      state: blockers.length > 0 ? (due ? "blocked" as const : "grace_blocked" as const) : due ? "ready" as const : "grace" as const,
    };
  }));
  const deleted = await handle.select({ pseudonym: tikisDeletedAccounts.pseudonym, accountType: tikisDeletedAccounts.accountType, deletedAt: tikisDeletedAccounts.deletedAt, purgeAfter: tikisDeletedAccounts.purgeAfter })
    .from(tikisDeletedAccounts).orderBy(desc(tikisDeletedAccounts.deletedAt)).limit(20);
  return { requests, recentlyDeleted: deleted };
}

/** Compte supprimé retrouvé par son ancien numéro, tant que la correspondance est conservée (10 ans). */
export async function findDeletedAccount(phone: string) {
  const handle = await database();
  return (await handle.select().from(tikisDeletedAccounts).where(eq(tikisDeletedAccounts.phone, phone)).orderBy(desc(tikisDeletedAccounts.deletedAt)))
    .map((row) => ({ pseudonym: row.pseudonym, accountType: row.accountType, deletedAt: row.deletedAt, purgeAfter: row.purgeAfter }));
}

async function pendingDeletionProfile(handle: Handle, phone: string) {
  const profile = (await handle.select().from(tikisProfiles).where(eq(tikisProfiles.phone, phone)).limit(1))[0];
  if (!profile) throw new Error("Profil introuvable.");
  if (profile.deletedAt) throw new Error("Ce compte est déjà supprimé.");
  if (!profile.deletionRequestedAt) throw new Error("Ce compte n’a pas demandé sa suppression.");
  return profile;
}

/**
 * Verser le solde restant avant la suppression : même circuit qu'un retrait (référence de versement
 * Mobile Money et note exigées, référence jamais réutilisée), double validation au-delà du seuil.
 */
export async function payoutClosingBalance(input: { phone: string; payoutReference: string; notes: string; requestId: string }, requester: { adminId: number; email: string }) {
  const payoutReference = input.payoutReference.trim();
  const notes = input.notes.trim();
  if (payoutReference.length < 4 || payoutReference.length > 80) throw new Error("Indiquez la référence du versement Mobile Money (4 à 80 caractères).");
  if (!notes) throw new Error("Ajoutez une note sur le versement (opérateur, numéro crédité…).");
  const handle = await database();
  const idempotencyKey = `closure-payout:${input.requestId}`;
  const payment = await handle.transaction(async (tx) => {
    await pendingDeletionProfile(tx, input.phone);
    const existing = (await tx.select().from(tikisPaymentTransactions).where(eq(tikisPaymentTransactions.idempotencyKey, idempotencyKey)).limit(1))[0];
    if (existing) return existing;
    const pending = (await tx.select({ id: tikisPaymentTransactions.id }).from(tikisPaymentTransactions).where(and(eq(tikisPaymentTransactions.profilePhone, input.phone), eq(tikisPaymentTransactions.status, "pending"))).limit(1))[0];
    if (pending) throw new Error("Un paiement ou un versement est déjà en attente pour ce compte : traitez-le d’abord (Finance ou Validations).");
    const wallet = (await tx.select().from(tikisWallets).where(eq(tikisWallets.profilePhone, input.phone)).limit(1).for("update"))[0];
    if (wallet && wallet.heldBalance > 0) throw new Error("Des commissions sont encore réservées sur des candidatures : elles doivent être libérées avant de verser le solde.");
    const amount = wallet?.availableBalance ?? 0;
    if (amount <= 0) throw new Error("Aucun solde à verser.");
    const id = randomUUID();
    const row = { id, profilePhone: input.phone, type: "withdrawal" as const, provider: "manual_payout" as const, amount, status: "pending" as const, providerReference: `closure-${id}`, idempotencyKey };
    await tx.insert(tikisPaymentTransactions).values(row);
    await tx.insert(tikisWalletLedger).values({ id: randomUUID(), profilePhone: input.phone, deliveryId: null, operation: "withdrawal_request", amount, availableBefore: amount, availableAfter: amount, heldBefore: 0, heldAfter: 0, reason: "Versement du solde avant suppression du compte", idempotencyKey: `${id}:requested` });
    return (await tx.select().from(tikisPaymentTransactions).where(eq(tikisPaymentTransactions.id, id)).limit(1))[0]!;
  });
  if (payment.status !== "pending") return { approvalRequired: false as const, amount: payment.amount, paymentId: payment.id, status: payment.status };
  try {
    if (await approvals.requiresApproval(payment.amount)) {
      const request = await approvals.requestWithdrawalSettlement(requester, { paymentId: payment.id, payoutReference, notes });
      return { ...request, amount: payment.amount, paymentId: payment.id };
    }
    const settled = await db.adminSettlePaymentTransaction({ paymentId: payment.id, outcome: "succeeded", adminId: requester.adminId, notes, payoutReference });
    return { approvalRequired: false as const, amount: payment.amount, paymentId: payment.id, status: settled.payment.status };
  } catch (cause) {
    // Référence déjà utilisée, solde modifié entre-temps… : rien n'a été versé ni débité ; le versement
    // en attente est annulé pour ne pas bloquer une nouvelle tentative.
    await handle.update(tikisPaymentTransactions).set({ status: "cancelled", settledAt: new Date(), adminNotes: "Versement de clôture non abouti" })
      .where(and(eq(tikisPaymentTransactions.id, payment.id), eq(tikisPaymentTransactions.status, "pending")));
    throw cause;
  }
}

// ————————————————————————————————————————————————————————————————————————
// Suppression définitive
// ————————————————————————————————————————————————————————————————————————

/** Tables où le numéro est gardé tel quel : la correspondance elle-même, et les comptes de la plateforme. */
const PHONE_KEPT_IN = new Set(["tikis_deleted_accounts", "users"]);
const PHONE_COLUMN = (name: string) => /phone$/i.test(name) || name === "phoneE164";

/** Colonnes de texte qui contiennent le numéro dans une clé ou un contenu (clés anti-doublon, demandes de validation). */
const TEXT_EMBEDDING_PHONE = [
  [tikisWalletLedger, tikisWalletLedger.idempotencyKey, "idempotencyKey"],
  [tikisPaymentTransactions, tikisPaymentTransactions.idempotencyKey, "idempotencyKey"],
  [tikisDeliveryEvents, tikisDeliveryEvents.idempotencyKey, "idempotencyKey"],
  [tikisAdminApprovals, tikisAdminApprovals.targetRef, "targetRef"],
  [tikisAdminApprovals, tikisAdminApprovals.payload, "payload"],
] as const;

/** Remplace le numéro par le pseudonyme dans toutes les tables qui le portent. */
async function pseudonymizePhone(tx: Tx, phone: string, pseudonym: string) {
  const tables = (Object.values(schema) as unknown[]).filter((value): value is MySqlTable => is(value, MySqlTable));
  for (const table of tables) {
    if (PHONE_KEPT_IN.has(getTableConfig(table).name)) continue;
    for (const [key, column] of Object.entries(getTableColumns(table))) {
      if (!PHONE_COLUMN(column.name)) continue;
      await tx.update(table).set({ [key]: pseudonym }).where(eq(column, phone));
    }
  }
  for (const [table, column, key] of TEXT_EMBEDDING_PHONE) {
    await tx.update(table).set({ [key]: sql`REPLACE(${column}, ${phone}, ${pseudonym})` }).where(like(column, `%${phone}%`));
  }
}

/**
 * Suppression définitive. Refusée avant la fin du délai de 30 jours, et tant qu'un blocage subsiste
 * (`DeletionBlockedError`). `adminId` absent : tâche planifiée.
 */
export async function finalizeAccountDeletion(phone: string, options: { adminId?: number; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const handle = await database();
  const result = await handle.transaction(async (tx) => {
    const profile = (await tx.select().from(tikisProfiles).where(eq(tikisProfiles.phone, phone)).limit(1).for("update"))[0];
    if (!profile) throw new Error("Profil introuvable.");
    if (profile.deletedAt) throw new Error("Ce compte est déjà supprimé.");
    if (!profile.deletionRequestedAt) throw new Error("Ce compte n’a pas demandé sa suppression.");
    if (profile.deletionScheduledAt && profile.deletionScheduledAt > now) {
      throw new Error(`Le délai de rétractation court jusqu’au ${profile.deletionScheduledAt.toLocaleDateString("fr-FR")} : l’utilisateur peut encore annuler.`);
    }
    const blockers = await deletionBlockers(tx, phone);
    if (blockers.length > 0) throw new DeletionBlockedError(blockers);

    // Photos de la pièce d'identité et photo de profil : effacées du stockage en tâche de fond (avec reprise),
    // et dès maintenant inaccessibles depuis l'application et la console.
    const submissions = await tx.select().from(tikisKycSubmissions).where(eq(tikisKycSubmissions.driverPhone, phone));
    const keys = [...submissions.flatMap((row) => [row.idFrontKey, row.idBackKey, row.selfieKey]), profile.photoKey].filter((key): key is string => !!key);
    if (keys.length) await tx.insert(tikisStorageErasures).values(keys.map((storageKey) => ({ id: randomUUID(), storageKey, reason: "account_deletion" })));
    if (submissions.length) await tx.update(tikisKycSubmissions).set({ idFrontKey: "", idBackKey: "", selfieKey: "", documentsErasedAt: now }).where(eq(tikisKycSubmissions.driverPhone, phone));

    // Données personnelles sans valeur comptable : effacées.
    await tx.delete(tikisPushTokens).where(eq(tikisPushTokens.phone, phone));
    await tx.delete(tikisProfileSessions).where(eq(tikisProfileSessions.phone, phone));
    await tx.delete(tikisDriverPreferences).where(eq(tikisDriverPreferences.profilePhone, phone));
    await tx.delete(tikisFavoritePlaces).where(eq(tikisFavoritePlaces.profilePhone, phone));
    await tx.delete(tikisDeliveryLiveLocations).where(eq(tikisDeliveryLiveLocations.driverPhone, phone));
    await tx.delete(tikisProfileNotes).where(eq(tikisProfileNotes.profilePhone, phone));
    await tx.delete(tikisRateLimits).where(or(like(tikisRateLimits.rateLimitKey, `%:${phone}:%`), like(tikisRateLimits.rateLimitKey, `%:${phone}`)));
    await tx.update(tikisProfiles).set({
      fullName: "Compte supprimé", email: null, emailVerified: false, photoKey: null, supabaseUserId: null, referralCode: null, city: null,
      statusReason: null, deletedAt: now, sessionsRevokedAt: now, updatedAt: now,
    }).where(eq(tikisProfiles.phone, phone));

    // Historique gardé 10 ans, sous pseudonyme ; le numéro est libéré.
    const pseudonym = `del-${randomBytes(8).toString("hex")}`;
    await pseudonymizePhone(tx, phone, pseudonym);
    const purgeAfter = new Date(now);
    purgeAfter.setFullYear(purgeAfter.getFullYear() + FINANCIAL_RETENTION_YEARS);
    await tx.insert(tikisDeletedAccounts).values({ pseudonym, phone, accountType: profile.accountType, deletedAt: now, purgeAfter, finalizedByAdminId: options.adminId ?? null });
    return { pseudonym, filesToErase: keys.length, purgeAfter };
  });
  invalidateTikisProfileCache(phone);
  return result;
}

/** Efface du stockage les fichiers en attente. Un échec est retenté au passage suivant (10 essais au plus). */
export async function processStorageErasures(limit = 50, erase: (key: string) => Promise<void> = storageErase) {
  const handle = await database();
  const pending = await handle.select().from(tikisStorageErasures).where(and(isNull(tikisStorageErasures.erasedAt), lt(tikisStorageErasures.attempts, ERASURE_MAX_ATTEMPTS))).orderBy(tikisStorageErasures.createdAt).limit(limit);
  let erased = 0;
  for (const row of pending) {
    try {
      await erase(row.storageKey);
      await handle.update(tikisStorageErasures).set({ erasedAt: new Date(), attempts: row.attempts + 1, lastError: null }).where(eq(tikisStorageErasures.id, row.id));
      erased += 1;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await handle.update(tikisStorageErasures).set({ attempts: row.attempts + 1, lastError: message.slice(0, 300) }).where(eq(tikisStorageErasures.id, row.id));
    }
  }
  return { erased, failed: pending.length - erased };
}

/** Au bout de 10 ans, la correspondance numéro ↔ pseudonyme est effacée : l'historique n'est plus rattachable. */
export async function purgeExpiredDeletedAccounts(now = new Date()) {
  const handle = await database();
  const result = await handle.delete(tikisDeletedAccounts).where(lte(tikisDeletedAccounts.purgeAfter, now));
  return { purged: (result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0 };
}

/** Tâche planifiée : suppressions arrivées à échéance (sauf celles bloquées), effacement des fichiers, purge à 10 ans. */
export async function runAccountDeletionJobs(now = new Date()) {
  const handle = await database();
  const due = await handle.select({ phone: tikisProfiles.phone }).from(tikisProfiles)
    .where(and(isNotNull(tikisProfiles.deletionScheduledAt), lte(tikisProfiles.deletionScheduledAt, now), isNull(tikisProfiles.deletedAt)));
  let finalized = 0;
  let blocked = 0;
  for (const row of due) {
    try {
      await finalizeAccountDeletion(row.phone, { now });
      finalized += 1;
    } catch (cause) {
      if (cause instanceof DeletionBlockedError) blocked += 1;
      else console.error("[account-deletion] suppression impossible", cause);
    }
  }
  const erasures = await processStorageErasures();
  const purge = await purgeExpiredDeletedAccounts(now);
  return { finalized, blocked, ...erasures, ...purge };
}
