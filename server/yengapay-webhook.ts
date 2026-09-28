/**
 * Traitement du webhook YengaPay, sorti de la route Express (server/_core/index.ts) pour pouvoir
 * être exercé tel quel contre une base de données dans les tests : c'est lui qui crédite les Wallets.
 */
import * as db from "./db";
import { parseYengapayWebhookEvent, readYengapayConfig, verifyYengapayWebhookSignature } from "./yengapay";

export type YengapayWebhookReply = { status: number; body: Record<string, unknown> };

function reply(status: number, body: Record<string, unknown>): YengapayWebhookReply {
  return { status, body };
}

export async function processYengapayWebhook({ rawBody, signature, headerEvent }: { rawBody: string; signature: string | null; headerEvent: string | null }): Promise<YengapayWebhookReply> {
  const config = readYengapayConfig();
  if (config.mode === "test") return reply(503, { error: "YengaPay externe est désactivé." });
  if (!verifyYengapayWebhookSignature(rawBody, signature, config.webhookSecret)) {
    return reply(400, { error: "Signature invalide" });
  }
  try {
    const event = parseYengapayWebhookEvent(rawBody, signature, headerEvent);
    // Le provider exact (sandbox/live + checkout/direct) est déterminé par la transaction
    // déjà enregistrée en base : on lit d'abord son provider pour logguer et router la notif
    // correctement. Si la transaction n'existe pas encore (race : webhook arrive avant que
    // l'appel API n'ait commité la ligne), on retombe sur le provider par défaut du mode
    // courant et le settle échouera avec un message clair — le webhook réessayé plus tard
    // trouvera la transaction.
    const preLookup = await db.lookupTikisPaymentByProviderReference(event.providerReference);
    const isDirect = preLookup?.provider.startsWith("yengapay_direct_") ?? false;
    const provider = isDirect
      ? (config.mode === "sandbox" ? "yengapay_direct_sandbox" : "yengapay_direct_live")
      : (config.mode === "sandbox" ? "yengapay_sandbox" : "yengapay_live");
    const recorded = await db.recordYengapayWebhookEvent({ provider, providerEventId: event.providerEventId, eventType: event.eventType, paymentTransactionId: preLookup?.id ?? null, payload: rawBody, signature });
    // Un doublon n'est ignoré que s'il a déjà été traité : un événement dont le règlement a échoué
    // (transaction pas encore enregistrée, base indisponible) est retraité à sa relivraison.
    if (recorded.duplicate && recorded.alreadyProcessed) {
      return reply(200, { ok: true, duplicate: true });
    }
    if (event.eventType.endsWith("pending")) {
      await db.markYengapayWebhookEvent(recorded.id, "ignored", { paymentTransactionId: preLookup?.id ?? null });
      return reply(202, { ok: true, pending: true });
    }
    const outcome: "succeeded" | "failed" | "cancelled" = event.eventType.endsWith("succeeded") ? "succeeded" : event.eventType.endsWith("cancelled") ? "cancelled" : "failed";
    try {
      const settled = await db.settleYengapayLivePayment({ providerReference: event.providerReference, outcome, reportedAmount: event.amount });
      await db.markYengapayWebhookEvent(recorded.id, "processed", { paymentTransactionId: settled.payment.id });
      // Notif push : paiement direct + succès ou échec → l'utilisateur est prévenu même
      // app fermée. Pour les paiements checkout (redirection web), la notif est redondante
      // puisque l'utilisateur voit déjà l'écran de confirmation dans le navigateur YengaPay.
      if (isDirect && preLookup?.profilePhone && settled?.payment?.id) {
        const phone = preLookup.profilePhone;
        if (outcome === "succeeded") {
          void db.enqueuePushToPhone({
            phone,
            title: "Dépôt Mobile Money confirmé",
            body: `${settled.payment.amount.toLocaleString("fr-FR")} FCFA crédités sur votre Wallet Tikis.`,
            data: { kind: "wallet_direct_deposit_succeeded", transactionId: settled.payment.id },
            channelId: "tikis-wallet",
          }).catch((pushError) => {
            console.error("[webhook:yengapay] push failed", pushError);
          });
        } else if (outcome === "failed" || outcome === "cancelled") {
          void db.enqueuePushToPhone({
            phone,
            title: "Dépôt Mobile Money échoué",
            body: "Le paiement n'a pas été confirmé par votre opérateur. Le solde de votre Wallet est inchangé.",
            data: { kind: "wallet_direct_deposit_failed", transactionId: settled.payment.id },
            channelId: "tikis-wallet",
          }).catch((pushError) => {
            console.error("[webhook:yengapay] push failed", pushError);
          });
        }
      }
      return reply(200, { ok: true });
    } catch (settleError) {
      const reason = settleError instanceof Error ? settleError.message : "Erreur inconnue";
      console.error("[webhook:yengapay] settle failed", settleError);
      await db.markYengapayWebhookEvent(recorded.id, "failed", { failureReason: reason }).catch(() => {});
      return reply(202, { ok: false, error: reason, willRetry: true });
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Erreur inconnue";
    console.error("[webhook:yengapay] parse failed", cause);
    return reply(400, { error: message });
  }
}
