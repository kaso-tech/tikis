/**
 * Double validation (quatre yeux) des mouvements d'argent décidés depuis la console.
 *
 * Au-delà du seuil (100 000 FCFA par défaut, réglable par un super-admin), un bonus, une pénalité, un
 * dédommagement après litige ou la validation d'un retrait n'est pas exécuté par l'admin qui le demande : il devient une demande en
 * attente, qu'un autre admin (super-admin ou finance) valide ou refuse. La validation exécute l'action à
 * ce moment-là, avec les mêmes garde-fous que l'action directe (idempotence, référence de versement…).
 *
 * États : pending → approved (prise en charge, exécution en cours) → executed | failed ; pending →
 * rejected (autre admin) | cancelled (demandeur). La prise en charge se fait sous verrou : deux admins
 * qui valident en même temps n'exécutent jamais deux fois.
 */
import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { tikisseAdminApprovals, tikissePaymentTransactions, tikissePlatformSettings, type TikisseAdminApproval } from "../drizzle/schema";
import { adminPenalizeWallet, adminRewardWallet } from "./admin-db";
import { adminDisputeRefund, validateDisputeRefund } from "./admin-disputes";
import * as db from "./db";

export const DEFAULT_APPROVAL_THRESHOLD = 100_000;
export const MIN_APPROVAL_THRESHOLD = 1_000;

export type ApprovalAction = TikisseAdminApproval["action"];
type WalletPayload = { phone: string; amount: number; reason: string; requestId: string };
type WithdrawalPayload = { paymentId: string; payoutReference: string; notes: string };
type DeliveryRefundPayload = WalletPayload & { deliveryId: string };

async function database() {
  const handle = await db.getDb();
  if (!handle) throw new Error("La console d’administration est temporairement indisponible.");
  return handle;
}

export async function getApprovalThreshold(): Promise<number> {
  const handle = await database();
  const row = (await handle.select({ threshold: tikissePlatformSettings.adminApprovalThreshold }).from(tikissePlatformSettings).where(eq(tikissePlatformSettings.id, 1)).limit(1))[0];
  return row?.threshold ?? DEFAULT_APPROVAL_THRESHOLD;
}

export async function setApprovalThreshold(threshold: number) {
  if (!Number.isSafeInteger(threshold) || threshold < MIN_APPROVAL_THRESHOLD) throw new Error(`Le seuil doit être d’au moins ${MIN_APPROVAL_THRESHOLD.toLocaleString("fr-FR")} FCFA.`);
  const handle = await database();
  await handle.insert(tikissePlatformSettings).values({ id: 1, adminApprovalThreshold: threshold }).onDuplicateKeyUpdate({ set: { adminApprovalThreshold: threshold } });
  return { threshold };
}

export async function requiresApproval(amount: number) {
  return amount >= await getApprovalThreshold();
}

type Requester = { adminId: number; email: string };

async function createRequest(requester: Requester, request: { action: ApprovalAction; amount: number; targetPhone: string; targetRef: string; payload: WalletPayload | WithdrawalPayload | DeliveryRefundPayload }) {
  const handle = await database();
  const id = randomUUID();
  await handle.transaction(async (tx) => {
    // Une seule demande en cours par cible : deux clics, ou deux admins, ne créent pas deux demandes pour
    // le même retrait ou la même opération.
    const open = await tx.select({ id: tikisseAdminApprovals.id }).from(tikisseAdminApprovals)
      .where(and(eq(tikisseAdminApprovals.targetRef, request.targetRef), inArray(tikisseAdminApprovals.status, ["pending", "approved"]))).limit(1).for("update");
    if (open[0]) throw new Error("Une demande de validation est déjà en attente pour cette opération.");
    await tx.insert(tikisseAdminApprovals).values({
      id, action: request.action, amount: request.amount, targetPhone: request.targetPhone, targetRef: request.targetRef,
      payload: JSON.stringify(request.payload), status: "pending", requestedByAdminId: requester.adminId, requestedByEmail: requester.email,
    });
  });
  return { approvalRequired: true as const, approvalId: id };
}

export function requestWalletAdjustment(requester: Requester, input: WalletPayload & { direction: "bonus" | "penalty" }) {
  const { direction, ...payload } = input;
  return createRequest(requester, {
    action: direction === "bonus" ? "wallet_bonus" : "wallet_penalty", amount: input.amount, targetPhone: input.phone,
    // L'identifiant d'opération tiré par l'écran : un double envoi retombe sur la même demande.
    targetRef: `${direction}:${input.phone}:${input.requestId}`.slice(0, 80), payload,
  });
}

/** Dédommagement après litige au-delà du seuil. Participant, montant et motif sont vérifiés dès la demande. */
export async function requestDeliveryRefund(requester: Requester, input: DeliveryRefundPayload) {
  await validateDisputeRefund(input);
  return createRequest(requester, {
    action: "delivery_refund", amount: input.amount, targetPhone: input.phone,
    targetRef: `refund:${input.deliveryId}:${input.phone}:${input.requestId}`.slice(0, 80), payload: { ...input, reason: input.reason.trim() },
  });
}

export async function requestWithdrawalSettlement(requester: Requester, input: WithdrawalPayload) {
  const handle = await database();
  const payment = (await handle.select().from(tikissePaymentTransactions).where(eq(tikissePaymentTransactions.id, input.paymentId)).limit(1))[0];
  if (!payment || payment.type !== "withdrawal") throw new Error("Retrait introuvable.");
  if (payment.status !== "pending") throw new Error("Ce retrait n’est plus en attente.");
  // Mêmes exigences que la validation directe, vérifiées dès la demande : inutile de faire valider une
  // demande qui échouerait à coup sûr.
  if (input.payoutReference.trim().length < 4) throw new Error("Indiquez la référence du versement Mobile Money (4 à 80 caractères) pour valider ce retrait.");
  if (!input.notes.trim()) throw new Error("Ajoutez une note sur le versement (opérateur, numéro crédité…) pour valider ce retrait.");
  return createRequest(requester, { action: "withdrawal_settle", amount: payment.amount, targetPhone: payment.profilePhone, targetRef: `withdrawal:${payment.id}`, payload: { paymentId: payment.id, payoutReference: input.payoutReference.trim(), notes: input.notes.trim() } });
}

export async function listApprovals(input: { status?: "open" | "closed"; limit?: number; offset?: number }) {
  const handle = await database();
  const where = input.status === "open" ? inArray(tikisseAdminApprovals.status, ["pending", "approved"])
    : input.status === "closed" ? inArray(tikisseAdminApprovals.status, ["executed", "failed", "rejected", "cancelled"]) : undefined;
  const [rows, total] = await Promise.all([
    handle.select().from(tikisseAdminApprovals).where(where).orderBy(desc(tikisseAdminApprovals.createdAt)).limit(Math.min(input.limit ?? 50, 200)).offset(Math.max(input.offset ?? 0, 0)),
    handle.select({ count: count() }).from(tikisseAdminApprovals).where(where),
  ]);
  return { rows: rows.map((row) => ({ ...row, payload: JSON.parse(row.payload) as Record<string, unknown> })), total: Number(total[0]?.count ?? 0) };
}

async function execute(approval: TikisseAdminApproval, approver: Requester) {
  const payload = JSON.parse(approval.payload) as DeliveryRefundPayload & WithdrawalPayload;
  if (approval.action === "wallet_bonus") return adminRewardWallet({ phone: payload.phone, amount: payload.amount, reason: payload.reason, adminId: approver.adminId, requestId: payload.requestId });
  if (approval.action === "wallet_penalty") return adminPenalizeWallet({ phone: payload.phone, amount: payload.amount, reason: payload.reason, adminId: approver.adminId, requestId: payload.requestId });
  if (approval.action === "delivery_refund") return adminDisputeRefund({ deliveryId: payload.deliveryId, phone: payload.phone, amount: payload.amount, reason: payload.reason, requestId: payload.requestId });
  const result = await db.adminSettlePaymentTransaction({ paymentId: payload.paymentId, outcome: "succeeded", adminId: approver.adminId, notes: payload.notes, payoutReference: payload.payoutReference });
  // Déjà réglé entre-temps (par YengaPay, ou rejeté) : rien n'a été fait, la demande ne doit pas passer pour exécutée.
  if (result.payment.status !== "succeeded") throw new Error(`Le retrait n’est plus en attente (statut : ${result.payment.status}).`);
  return result;
}

/**
 * Validation par un second admin, puis exécution. Jamais par le demandeur lui-même. Si l'exécution échoue
 * (solde devenu insuffisant, référence déjà utilisée…), la demande passe en échec avec la raison ; rien
 * n'a été débité ni crédité, et une nouvelle demande peut être faite.
 */
export async function approveRequest(input: { approvalId: string; approver: Requester }) {
  const handle = await database();
  const approval = await handle.transaction(async (tx) => {
    const row = (await tx.select().from(tikisseAdminApprovals).where(eq(tikisseAdminApprovals.id, input.approvalId)).limit(1).for("update"))[0];
    if (!row) throw new Error("Demande introuvable.");
    if (row.status !== "pending") throw new Error("Cette demande a déjà été traitée.");
    if (row.requestedByAdminId === input.approver.adminId) throw new Error("Vous ne pouvez pas valider votre propre demande : un second admin doit le faire.");
    await tx.update(tikisseAdminApprovals).set({ status: "approved", decidedByAdminId: input.approver.adminId, decidedByEmail: input.approver.email, decidedAt: new Date() }).where(eq(tikisseAdminApprovals.id, row.id));
    return row;
  });
  try {
    await execute(approval, input.approver);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "Exécution impossible.";
    await handle.update(tikisseAdminApprovals).set({ status: "failed", failureReason: reason.slice(0, 500) }).where(eq(tikisseAdminApprovals.id, approval.id));
    return { status: "failed" as const, failureReason: reason, approval };
  }
  await handle.update(tikisseAdminApprovals).set({ status: "executed" }).where(eq(tikisseAdminApprovals.id, approval.id));
  return { status: "executed" as const, approval };
}

/** Refus par un autre admin, ou retrait par le demandeur. Seule une demande en attente se refuse ou se retire. */
export async function closeRequest(input: { approvalId: string; admin: Requester; note?: string }) {
  const handle = await database();
  return handle.transaction(async (tx) => {
    const row = (await tx.select().from(tikisseAdminApprovals).where(eq(tikisseAdminApprovals.id, input.approvalId)).limit(1).for("update"))[0];
    if (!row) throw new Error("Demande introuvable.");
    if (row.status !== "pending") throw new Error("Cette demande a déjà été traitée.");
    const status = row.requestedByAdminId === input.admin.adminId ? "cancelled" as const : "rejected" as const;
    await tx.update(tikisseAdminApprovals).set({ status, decidedByAdminId: input.admin.adminId, decidedByEmail: input.admin.email, decidedAt: new Date(), decisionNote: input.note?.trim().slice(0, 300) || null }).where(eq(tikisseAdminApprovals.id, row.id));
    return { status, approval: row };
  });
}
