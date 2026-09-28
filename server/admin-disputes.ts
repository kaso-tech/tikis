/**
 * Outils de litige de la console, rattachés à une livraison, et modération des avis.
 *
 * Jusqu'ici, dédommager quelqu'un après un litige passait par un bonus générique : rien ne le reliait à la
 * livraison concernée, et la chronologie du litige ne le montrait pas. Désormais :
 *  - un dédommagement (geste commercial) est un mouvement « refund » portant l'identifiant de la livraison ;
 *  - rendre sa commission au livreur est un mouvement « compensation », plafonné à ce qu'il a réellement
 *    payé pour cette livraison, moins ce qui lui a déjà été rendu.
 * Les deux apparaissent dans la chronologie du litige et dans le relevé comptable.
 */
import { createHash, randomUUID } from "node:crypto";
import { and, count, desc, eq, isNotNull, like, lte, ne, or } from "drizzle-orm";
import { tikisDeliveries, tikisDeliveryCandidates, tikisDeliveryReviews, tikisProfiles } from "../drizzle/schema";
import * as db from "./db";

export const DISPUTE_REFUND_MAX = 1_000_000;

async function database() {
  const handle = await db.getDb();
  if (!handle) throw new Error("La console d’administration est temporairement indisponible.");
  return handle;
}

/** Les profils qui ont pris part à la livraison : expéditeur, livreur actuel ou précédent, candidats. */
async function assertParticipant(tx: any, deliveryId: string, phone: string) {
  const delivery = (await tx.select().from(tikisDeliveries).where(eq(tikisDeliveries.id, deliveryId)).limit(1).for("update"))[0];
  if (!delivery) throw new Error("Livraison introuvable.");
  if ([delivery.senderPhone, delivery.driverPhone, delivery.previousDriverPhone].includes(phone)) return delivery;
  const candidate = (await tx.select({ id: tikisDeliveryCandidates.id }).from(tikisDeliveryCandidates).where(and(eq(tikisDeliveryCandidates.deliveryId, deliveryId), eq(tikisDeliveryCandidates.driverPhone, phone))).limit(1))[0];
  if (!candidate) throw new Error("Ce profil n’a pas pris part à cette livraison.");
  return delivery;
}

type DisputeRefundInput = { deliveryId: string; phone: string; amount: number; reason: string; requestId: string };

function checkRefundInput(input: DisputeRefundInput) {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > DISPUTE_REFUND_MAX) throw new Error("Montant de dédommagement invalide.");
  const reason = input.reason.trim();
  if (!reason) throw new Error("Indiquez le motif du dédommagement.");
  return reason;
}

/** Vérifications d'un dédommagement sans l'exécuter : utilisé avant de le soumettre à validation. */
export async function validateDisputeRefund(input: DisputeRefundInput) {
  checkRefundInput(input);
  const handle = await database();
  await handle.transaction((tx) => assertParticipant(tx, input.deliveryId, input.phone));
}

/** Dédommagement décidé à l'issue d'un litige, crédité au Wallet et visible dans la chronologie. */
export async function adminDisputeRefund(input: DisputeRefundInput) {
  const reason = checkRefundInput(input);
  const handle = await database();
  return handle.transaction(async (tx) => {
    await assertParticipant(tx, input.deliveryId, input.phone);
    // Clé liée à la livraison, au profil et à l'identifiant d'opération tiré par l'écran : un double envoi ne
    // dédommage jamais deux fois. Condensée : les clés du journal sont limitées à 100 caractères.
    const key = `dispute-refund:${createHash("sha256").update(`${input.deliveryId}:${input.phone}:${input.requestId}`).digest("hex")}`;
    await db.applyWalletMovement(tx, { profilePhone: input.phone, deliveryId: input.deliveryId, operation: "refund", amount: input.amount, availableDelta: input.amount, heldDelta: 0, reason: `Dédommagement après litige : ${reason}`, idempotencyKey: key });
    await db.appendDeliveryEvent(tx, { deliveryId: input.deliveryId, eventType: "admin_dispute_refund", recipientPhone: input.phone, title: "Dédommagement reçu", body: `L’équipe Tikis vous a crédité ${input.amount.toLocaleString("fr-FR")} FCFA : ${reason}.`, tone: "success", idempotencyKey: key });
    return { phone: input.phone, amount: input.amount };
  });
}

/**
 * Rendre au livreur la commission payée pour cette livraison : exactement ce qu'il a payé, moins ce qui
 * lui a déjà été rendu. Rien à rendre si la commission n'a pas été prélevée ou déjà remboursée.
 */
export async function adminRefundDriverCommission(input: { deliveryId: string; driverPhone: string; reason: string }) {
  const reason = input.reason.trim();
  if (!reason) throw new Error("Indiquez le motif du remboursement.");
  const handle = await database();
  return handle.transaction(async (tx) => {
    await assertParticipant(tx, input.deliveryId, input.driverPhone);
    const amount = await db.netCommissionPaid(tx, input.deliveryId, input.driverPhone);
    if (amount <= 0) throw new Error("Aucune commission à rendre : elle n’a pas été prélevée, ou a déjà été remboursée.");
    const key = `commission-refund:${randomUUID()}`;
    await db.applyWalletMovement(tx, { profilePhone: input.driverPhone, deliveryId: input.deliveryId, operation: "compensation", amount, availableDelta: amount, heldDelta: 0, reason: `Commission remboursée après litige : ${reason}`, idempotencyKey: key });
    await db.appendDeliveryEvent(tx, { deliveryId: input.deliveryId, eventType: "admin_commission_refund", recipientPhone: input.driverPhone, title: "Commission remboursée", body: `L’équipe Tikis vous a remboursé la commission de ${amount.toLocaleString("fr-FR")} FCFA de cette livraison : ${reason}.`, tone: "success", idempotencyKey: key });
    return { driverPhone: input.driverPhone, amount };
  });
}

/** Commission encore remboursable par livreur, pour l'affichage du litige. */
export async function refundableCommissions(deliveryId: string) {
  const handle = await database();
  const candidates = await handle.select({ driverPhone: tikisDeliveryCandidates.driverPhone }).from(tikisDeliveryCandidates).where(eq(tikisDeliveryCandidates.deliveryId, deliveryId));
  const phones = Array.from(new Set(candidates.map((row) => row.driverPhone)));
  const amounts = await Promise.all(phones.map(async (driverPhone) => ({ driverPhone, amount: await db.netCommissionPaid(handle, deliveryId, driverPhone) })));
  return amounts.filter((row) => row.amount > 0);
}

// ————————————————————————————————————————————————————————————————————————
// Modération des avis
// ————————————————————————————————————————————————————————————————————————

export type ReviewFilter = "all" | "low" | "commented" | "hidden";

/** Avis, les plus récents d'abord. « low » : 1 ou 2 étoiles. `query` : téléphone du livreur ou de l'auteur. */
export async function adminListReviews(input: { filter?: ReviewFilter; query?: string; limit?: number; offset?: number }) {
  const handle = await database();
  const query = input.query?.replace(/[^0-9+]/g, "");
  const where = and(
    input.filter === "hidden" ? isNotNull(tikisDeliveryReviews.hiddenAt) : undefined,
    input.filter === "low" ? lte(tikisDeliveryReviews.rating, 2) : undefined,
    input.filter === "commented" ? and(isNotNull(tikisDeliveryReviews.comment), ne(tikisDeliveryReviews.comment, "")) : undefined,
    query && query.length >= 4 ? or(like(tikisDeliveryReviews.driverPhone, `%${query}%`), like(tikisDeliveryReviews.reviewerPhone, `%${query}%`)) : undefined,
  );
  const [rows, total] = await Promise.all([
    handle.select({ review: tikisDeliveryReviews, driverName: tikisProfiles.fullName }).from(tikisDeliveryReviews)
      .leftJoin(tikisProfiles, eq(tikisProfiles.phone, tikisDeliveryReviews.driverPhone))
      .where(where).orderBy(desc(tikisDeliveryReviews.createdAt)).limit(Math.min(input.limit ?? 50, 200)).offset(Math.max(input.offset ?? 0, 0)),
    handle.select({ count: count() }).from(tikisDeliveryReviews).where(where),
  ]);
  return { rows: rows.map((row) => ({ ...row.review, driverName: row.driverName })), total: Number(total[0]?.count ?? 0) };
}

/** Masquer un avis (injurieux, hors sujet, frauduleux) : il ne s'affiche plus et ne compte plus dans la note. */
export async function adminSetReviewHidden(input: { reviewId: string; hidden: boolean; reason?: string; adminId: number }) {
  const handle = await database();
  const review = (await handle.select().from(tikisDeliveryReviews).where(eq(tikisDeliveryReviews.id, input.reviewId)).limit(1))[0];
  if (!review) throw new Error("Avis introuvable.");
  if (input.hidden) {
    const reason = input.reason?.trim();
    if (!reason) throw new Error("Indiquez pourquoi cet avis est masqué.");
    await handle.update(tikisDeliveryReviews).set({ hiddenAt: new Date(), hiddenReason: reason.slice(0, 300), hiddenByAdminId: input.adminId }).where(eq(tikisDeliveryReviews.id, input.reviewId));
  } else {
    await handle.update(tikisDeliveryReviews).set({ hiddenAt: null, hiddenReason: null, hiddenByAdminId: null }).where(and(eq(tikisDeliveryReviews.id, input.reviewId), isNotNull(tikisDeliveryReviews.hiddenAt)));
  }
  return { before: review.hiddenAt ? "hidden" : "visible", after: input.hidden ? "hidden" : "visible", driverPhone: review.driverPhone, rating: review.rating };
}

