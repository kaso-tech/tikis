/**
 * Code USSD pour les paiements directs YengaPay (in-app Mobile Money).
 *
 * Partagé entre le client (components/tikis/wallet-direct-deposit.tsx — affichage temps réel du
 * code dans le lien "Appeler") et le serveur (server/yengapay-direct.ts — code stocké dans
 * tikis_payment_transactions.ussdCode au moment de la création de l'intent).
 *
 * Si la sandbox YengaPay retourne un pattern différent pour Orange/Moov, ce fichier est l'unique
 * endroit à modifier. Voir docs/yengapay-sandbox-setup.md section 7 (debugging) et le runbook
 * pour le workflow de validation.
 */

export type YengapayOperatorCode = "orange_money" | "moov_money";

/**
 * Construit le code USSD à composer pour un opérateur et un montant donné.
 * - Orange Money BF/CI/SN/ML : *144*4*6*<montant># (code marchand 4*6, 6 = identifiant API).
 * - Moov Money BJ/TG        : *555*4*<montant># (code marchand 4, à valider avec sandbox).
 *
 * Renvoie une chaîne vide si le montant est invalide (permet aux UI de masquer le code plutôt
 * que d'afficher "*144*4*6*NaN#").
 */
export function buildUssdCode(operator: YengapayOperatorCode, amount: number): string {
  if (!Number.isFinite(amount) || amount < 100) return "";
  if (operator === "orange_money") return `*144*4*6*${amount}#`;
  return `*555*4*${amount}#`;
}

export function operatorLabel(operator: YengapayOperatorCode): string {
  return operator === "orange_money" ? "Orange Money" : "Moov Money";
}
