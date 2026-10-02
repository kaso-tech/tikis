/**
 * Rechargement du Wallet par Mobile Money, sans quitter l'application.
 *
 * Deux prestataires : YengaPay (server/yengapay-direct.ts) et LigdiCash (server/ligdicash.ts). Un nouveau
 * paiement part chez celui que désigne TIKISSE_DIRECT_PAYMENT_PROVIDER (« ligdicash » ou « yengapay », par
 * défaut) ; un paiement déjà créé reste chez son prestataire jusqu'au bout, même si le réglage change.
 *
 * LigdiCash, par opérateur (Burkina Faso) :
 *  - Orange Money : le client compose *144*4*6# pour obtenir un code, le saisit dans l'application, et une
 *    seule demande part alors chez LigdiCash avec le numéro et ce code ;
 *  - Moov Money : la demande part tout de suite, sans code ; l'opérateur affiche un écran de validation sur
 *    le téléphone du client, qui confirme avec son code PIN.
 * Dans les deux cas, le Wallet n'est crédité qu'une fois le paiement confirmé par la vérification LigdiCash.
 */
import { randomUUID } from "node:crypto";
import * as db from "./db";
import * as yengapay from "./yengapay-direct";
import { createLigdicashPayin, getLigdicashPayinStatus, LigdicashError, readLigdicashConfig } from "./ligdicash";
import type { YengapayOperatorCode } from "../shared/yengapay-ussd";

export type DirectDepositView = Omit<yengapay.YengapayDirectDeposit, "flow"> & {
  flow: yengapay.YengapayDirectDeposit["flow"] | "PUSH";
  provider: "yengapay" | "ligdicash";
};

export type DirectDepositRequest = yengapay.YengapayDirectDepositRequest;

const DEPOSIT_LIFETIME_MS = 15 * 60_000;
/** Code USSD qui donne à un client Orange Money Burkina son code de paiement LigdiCash. */
export const LIGDICASH_ORANGE_OTP_USSD = "*144*4*6#";

export function directPaymentProvider(env: Record<string, string | undefined> = process.env): "yengapay" | "ligdicash" {
  return env.TIKISSE_DIRECT_PAYMENT_PROVIDER?.trim().toLowerCase() === "ligdicash" ? "ligdicash" : "yengapay";
}

function fromYengapay(view: yengapay.YengapayDirectDeposit): DirectDepositView {
  return { ...view, provider: "yengapay" };
}

function ligdicashView(stored: db.DirectDepositRecord): DirectDepositView {
  const orange = stored.operator === "orange_money";
  return {
    transactionId: stored.transactionId,
    providerReference: stored.providerReference,
    ussdCode: orange ? LIGDICASH_ORANGE_OTP_USSD : "",
    amount: stored.amount,
    phone: stored.phone,
    operator: stored.operator,
    countryCode: stored.countryCode,
    expiresAt: stored.expiresAt,
    status: stored.status,
    mode: stored.mode,
    // Orange : un code à saisir tant que la demande n'est pas partie ; ensuite, on attend l'opérateur.
    requiresOtp: orange && !stored.providerToken,
    flow: orange ? "ONE_STEP" : "PUSH",
    otpInstructions: orange
      ? (stored.providerToken
        ? "Code envoyé. L'opérateur valide le paiement : cela peut prendre quelques secondes à quelques minutes."
        : `Composez ${LIGDICASH_ORANGE_OTP_USSD} sur votre téléphone Orange Money pour obtenir votre code de paiement, puis saisissez-le ici.`)
      : "Une demande de paiement s'affiche sur votre téléphone : validez-la avec votre code PIN Moov Money. Si rien ne s'affiche, composez *555# et suivez le menu des paiements en attente.",
    provider: "ligdicash",
  };
}

/** Applique le statut confirmé par LigdiCash à la transaction locale. */
async function applyLigdicashStatus(stored: db.DirectDepositRecord): Promise<db.DirectDepositRecord> {
  if (!stored.providerToken || stored.status === "succeeded") return stored;
  const remote = await getLigdicashPayinStatus(stored.providerToken);
  if (remote.status === "succeeded") {
    if (remote.amount !== null && remote.amount < stored.amount) {
      // Payé moins que demandé : on ne crédite pas le montant demandé. Reste en attente, visible dans la console.
      console.error(`[ligdicash] montant confirmé ${remote.amount} < montant demandé ${stored.amount} (transaction ${stored.transactionId}) : non crédité.`);
      return stored;
    }
    await db.settleTikisseWalletDepositRequest({ profilePhone: stored.profilePhone, transactionId: stored.transactionId });
  } else if (remote.status === "failed") {
    await db.refuseTikisseWalletDepositRequest({ profilePhone: stored.profilePhone, transactionId: stored.transactionId });
  }
  return (await db.getDirectDepositIntent(stored.transactionId, stored.profilePhone)) ?? stored;
}

/** Envoie la demande chez LigdiCash ; un refus immédiat clôt la transaction, avec la raison donnée. */
async function sendLigdicashPayin(stored: db.DirectDepositRecord, otp: string) {
  try {
    const token = await createLigdicashPayin({
      transactionId: stored.transactionId,
      amount: stored.amount,
      phone: stored.phone,
      otp,
      description: `Rechargement Wallet Tikisse (${stored.amount} FCFA)`,
    });
    await db.setDirectDepositProviderToken(stored.transactionId, token);
  } catch (error) {
    // Refus explicite (code faux, solde insuffisant…) : la transaction est perdue, on le dit. Une panne
    // réseau, elle, laisse la transaction en attente : le client peut réessayer.
    if (error instanceof LigdicashError && error.responseCode) {
      await db.refuseTikisseWalletDepositRequest({ profilePhone: stored.profilePhone, transactionId: stored.transactionId });
    }
    throw error;
  }
}

export async function createDirectDeposit(input: DirectDepositRequest): Promise<DirectDepositView> {
  const existing = await db.getDirectDepositByIdempotencyKey(input.profilePhone, input.idempotencyKey);
  if (existing?.provider === "ligdicash") return ligdicashView(existing);
  if (existing || directPaymentProvider() === "yengapay") return fromYengapay(await yengapay.createYengapayDirectDeposit(input));

  const config = readLigdicashConfig();
  const transactionId = randomUUID();
  await db.recordDirectDepositIntent({
    transactionId,
    profilePhone: input.profilePhone,
    amount: input.amount,
    phone: input.phone,
    operator: input.operator,
    countryCode: input.countryCode,
    ussdCode: input.operator === "orange_money" ? LIGDICASH_ORANGE_OTP_USSD : "",
    expiresAt: new Date(Date.now() + DEPOSIT_LIFETIME_MS).toISOString(),
    providerReference: `LIGDICASH-${transactionId}`,
    idempotencyKey: input.idempotencyKey,
    mode: config.mode,
    provider: "ligdicash",
  });
  let stored = await db.getDirectDepositIntent(transactionId, input.profilePhone);
  if (!stored) throw new Error("La demande de paiement n'a pas pu être enregistrée.");
  // Moov : pas de code, la demande part tout de suite et l'opérateur sollicite le client sur son téléphone.
  if (input.operator === "moov_money") {
    await sendLigdicashPayin(stored, "");
    stored = (await db.getDirectDepositIntent(transactionId, input.profilePhone)) ?? stored;
  }
  return ligdicashView(stored);
}

export async function payDirectDeposit(input: { profilePhone: string; transactionId: string; otp: string }): Promise<DirectDepositView> {
  const stored = await db.getDirectDepositIntent(input.transactionId, input.profilePhone);
  if (!stored) throw new Error("Transaction de dépôt introuvable ou expirée.");
  if (stored.provider === "yengapay") return fromYengapay(await yengapay.payYengapayDirectDeposit(input));
  if (stored.status !== "pending") return ligdicashView(stored);
  // Déjà envoyée (double appui, relance réseau) : on ne redemande jamais un second paiement.
  if (stored.providerToken) return ligdicashView(await applyLigdicashStatus(stored));
  if (stored.operator !== "orange_money") return ligdicashView(stored);
  if (!/^[0-9]{4,12}$/.test(input.otp)) throw new Error("Le code doit contenir uniquement des chiffres.");
  await sendLigdicashPayin(stored, input.otp);
  const sent = (await db.getDirectDepositIntent(input.transactionId, input.profilePhone)) ?? stored;
  return ligdicashView(await applyLigdicashStatus(sent));
}

export async function getDirectDepositStatus(input: { profilePhone: string; transactionId: string }): Promise<DirectDepositView> {
  const stored = await db.getDirectDepositIntent(input.transactionId, input.profilePhone);
  if (!stored) throw new Error("Transaction de dépôt introuvable ou expirée.");
  if (stored.provider === "yengapay") return fromYengapay(await yengapay.getYengapayDirectDepositStatus(input));
  if (stored.status !== "pending") return ligdicashView(stored);
  const pastDeadline = new Date(stored.expiresAt).getTime() <= Date.now();
  // Passé le délai, LigdiCash est consulté d'abord : un paiement validé à la dernière minute est crédité.
  const checked = await applyLigdicashStatus(stored).catch(() => stored);
  if (checked.status === "pending" && pastDeadline) {
    return ligdicashView(await db.cancelTikisseWalletDirectDeposit({ profilePhone: input.profilePhone, transactionId: input.transactionId, status: "expired" }));
  }
  return ligdicashView(checked);
}

export async function resendDirectDepositOtp(input: { profilePhone: string; transactionId: string }): Promise<DirectDepositView> {
  const stored = await db.getDirectDepositIntent(input.transactionId, input.profilePhone);
  if (!stored) throw new Error("Transaction de dépôt introuvable ou expirée.");
  if (stored.provider === "yengapay") return fromYengapay(await yengapay.resendYengapayDirectOtp(input));
  // LigdiCash : pas de code envoyé par SMS ; le client Orange le redemande lui-même par *144*4*6#.
  return ligdicashView(stored);
}

export async function cancelDirectDeposit(input: { profilePhone: string; transactionId: string }): Promise<DirectDepositView> {
  const stored = await db.getDirectDepositIntent(input.transactionId, input.profilePhone);
  if (!stored) throw new Error("Transaction de dépôt introuvable ou expirée.");
  if (stored.provider === "yengapay") return fromYengapay(await yengapay.cancelYengapayDirectDeposit(input));
  return ligdicashView(await db.cancelTikisseWalletDirectDeposit({ profilePhone: input.profilePhone, transactionId: input.transactionId, status: "cancelled" }));
}

export async function settleDirectDepositTest(input: { profilePhone: string; transactionId: string; outcome: "succeeded" | "failed" }): Promise<DirectDepositView> {
  const stored = await db.getDirectDepositIntent(input.transactionId, input.profilePhone);
  if (stored?.provider === "ligdicash") throw new Error("Un paiement LigdiCash ne se règle pas à la main : seule la confirmation LigdiCash le crédite.");
  return fromYengapay(await yengapay.settleYengapayDirectDepositTest(input));
}

/**
 * Rappel de LigdiCash (POST /api/webhooks/ligdicash?transaction=…). Son contenu n'est pas cru : il sert
 * seulement de signal ; le statut est redemandé à LigdiCash avec le jeton enregistré chez nous.
 */
export async function handleLigdicashCallback(transactionId: string | undefined): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!transactionId || !/^[0-9a-f-]{36}$/i.test(transactionId)) return { status: 400, body: { ok: false, error: "transaction manquante" } };
  const stored = await db.getDirectDepositById(transactionId);
  if (!stored || stored.provider !== "ligdicash") return { status: 404, body: { ok: false, error: "transaction inconnue" } };
  const updated = await applyLigdicashStatus(stored);
  return { status: 200, body: { ok: true, status: updated.status } };
}

export type { YengapayOperatorCode };
