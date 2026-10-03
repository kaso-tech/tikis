/**
 * Opérateurs Mobile Money proposés pour recharger le Wallet, pays par pays, et la façon dont chacun fait
 * valider le paiement. Une seule table, lue par le serveur (opérateurs acceptés, parcours de paiement, limites)
 * et par l'application (opérateurs affichés selon le pays du profil, consignes).
 *
 * LigdiCash — d'après ses fiches « Intégration par opérateur » (payin sans redirection, toujours
 * POST /pay/v01/straight/checkout-invoice/create, numéro du client sans « + » dans `customer`) :
 *  - otp_ussd    : le client obtient un code en composant un code USSD et le saisit dans l'application ;
 *                  une seule demande part alors, avec ce code (Orange Burkina) ;
 *  - push        : la demande part tout de suite (`otp: ""`) ; l'opérateur affiche une demande sur le téléphone
 *                  du client, qui valide avec son code PIN. Moov Burkina et Moov Côte d'Ivoire basculent
 *                  d'eux-mêmes en USSD guidé (SMS) si le push n'aboutit pas : la consigne couvre les deux cas ;
 *  - guided_ussd : la demande part tout de suite ; l'opérateur envoie un SMS avec un code USSD à composer,
 *                  puis le client valide avec son code PIN (Zamani Niger, MTN Côte d'Ivoire) ;
 *  - redirect    : la demande part tout de suite ; `response_text` contient l'adresse d'une page de paiement à
 *                  ouvrir — portail de l'opérateur (Orange Côte d'Ivoire, Orange Mali) ou page LigdiCash où
 *                  le numéro est prérempli (Sénégal, Guinée, Orange RD Congo).
 * `free_money` n'est plus proposé (Free Money Sénégal est devenu Mixx by Yas) : l'identifiant reste reconnu pour
 * l'historique.
 * Un opérateur absent de la table n'est pas proposé : ajouter un pays ou un opérateur se fait ici seulement.
 * Un pays de la table n'apparaît que s'il fait partie des pays d'inscription (lib/registration-rules.ts).
 */

export type MobileMoneyOperatorId =
  | "orange_money" | "moov_money" | "mtn_money" | "wave" | "airtel_money" | "yas_money"
  | "zamani_money" | "free_money" | "vodacom_mpesa" | "africell_money";
export type MobileMoneyFlow = "otp_ussd" | "push" | "guided_ussd" | "redirect";

export type MobileMoneyOperator = {
  id: MobileMoneyOperatorId;
  /** Nom affiché. */
  label: string;
  /** Initiales de la pastille. */
  short: string;
  /** Couleur de la pastille (marque de l'opérateur). */
  color: string;
  flow: MobileMoneyFlow;
  /** Code USSD qui donne le code de paiement (otp_ussd). */
  otpUssd?: string;
  /** Consigne affichée pendant l'attente. */
  instructions: string;
  /** Montant minimum accepté par l'opérateur (FCFA), s'il est plus strict que celui de Tikisse. */
  minAmount?: number;
  /** Montant maximum accepté par l'opérateur (FCFA). */
  maxAmount?: number;
};

export const MOBILE_MONEY_OPERATOR_IDS = [
  "orange_money", "moov_money", "mtn_money", "wave", "airtel_money", "yas_money",
  "zamani_money", "free_money", "vodacom_mpesa", "africell_money",
] as const satisfies readonly MobileMoneyOperatorId[];

/** Limites d'un rechargement, toutes prestataires confondues. */
export const DIRECT_DEPOSIT_MIN_AMOUNT = 100;
export const DIRECT_DEPOSIT_MAX_AMOUNT = 10_000_000;

const ORANGE = { id: "orange_money", label: "Orange Money", short: "OM", color: "#C96900" } as const;
const MOOV = { id: "moov_money", label: "Moov Money", short: "MV", color: "#0033A0" } as const;
const MTN = { id: "mtn_money", label: "MTN MoMo", short: "MTN", color: "#B58900" } as const;
const WAVE = { id: "wave", label: "Wave", short: "WV", color: "#1A73C9" } as const;
const AIRTEL = { id: "airtel_money", label: "Airtel Money", short: "AM", color: "#C8102E" } as const;
const YAS = { id: "yas_money", label: "Mixx by Yas", short: "YAS", color: "#F9D908" } as const;
const ZAMANI = { id: "zamani_money", label: "Zamani Money", short: "ZM", color: "#D9530F" } as const;
const MPESA = { id: "vodacom_mpesa", label: "M-Pesa (Vodacom)", short: "MP", color: "#C8102E" } as const;
// « Africell Money » chez LigdiCash ; le service s'appelle Afrimoney.
const AFRICELL = { id: "africell_money", label: "Afrimoney", short: "AF", color: "#A11776" } as const;

/** Consigne d'attente des fiches LigdiCash (USSD Push). */
const push = (pin: string) =>
  `Validez le paiement sur votre téléphone. Vous allez recevoir une demande USSD à approuver avec votre code PIN ${pin}.`;
/** USSD Push avec repli en USSD guidé : le client reçoit l'un ou l'autre. */
const PUSH_OR_SMS = "Validez le paiement sur votre téléphone. Vous allez recevoir une demande de validation USSD, ou un SMS avec les instructions à suivre.";
const operatorPortal = (operator: string) =>
  `Ouvrez la page de paiement ${operator}, connectez-vous et confirmez le paiement : votre Wallet est crédité dès la confirmation.`;
const ligdicashPage = (operator: string) =>
  `Ouvrez la page de paiement : votre numéro y est déjà saisi et ${operator} présélectionné. Confirmez le paiement : votre Wallet est crédité dès la confirmation.`;

/** LigdiCash : opérateurs par pays (code ISO du profil). */
export const LIGDICASH_OPERATORS: Readonly<Record<string, readonly MobileMoneyOperator[]>> = {
  BJ: [
    { ...MOOV, flow: "push", instructions: push("Moov Money"), minAmount: 100 },
    { ...MTN, flow: "push", instructions: push("MoMo"), minAmount: 100 },
  ],
  BF: [
    { ...ORANGE, flow: "otp_ussd", otpUssd: "*144*4*6#", instructions: "Composez le code ci-dessous (montant compris) sur votre téléphone Orange pour obtenir votre code de paiement, puis saisissez-le ici sans attendre : il expire vite.", minAmount: 10, maxAmount: 2_000_000 },
    { ...MOOV, flow: "push", instructions: PUSH_OR_SMS, minAmount: 100, maxAmount: 2_000_000 },
  ],
  CI: [
    { ...ORANGE, flow: "redirect", instructions: operatorPortal("Orange Money"), minAmount: 10 },
    { ...MOOV, flow: "push", instructions: PUSH_OR_SMS, minAmount: 100 },
    // Absent des fiches opérateur ; documenté par LigdiCash en USSD guidé.
    { ...MTN, flow: "guided_ussd", instructions: "Vous allez recevoir un SMS de MTN avec un code USSD : composez-le, puis confirmez avec votre code PIN MoMo." },
  ],
  GN: [
    { ...ORANGE, flow: "redirect", instructions: ligdicashPage("Orange Money"), minAmount: 200 },
    { ...MTN, flow: "redirect", instructions: ligdicashPage("MTN MoMo"), minAmount: 200 },
  ],
  ML: [
    { ...ORANGE, flow: "redirect", instructions: operatorPortal("Orange Money"), minAmount: 100 },
  ],
  NE: [
    { ...AIRTEL, flow: "push", instructions: push("Airtel Money"), minAmount: 10 },
    { ...ZAMANI, flow: "guided_ussd", instructions: "Vous allez recevoir un SMS sur votre téléphone avec les instructions pour valider le paiement. Composez le code USSD indiqué et confirmez avec votre code PIN Zamani Money.", minAmount: 10 },
    { ...MOOV, flow: "push", instructions: push("Moov Money") },
  ],
  CD: [
    { ...ORANGE, flow: "redirect", instructions: ligdicashPage("Orange Money"), minAmount: 10 },
    { ...MPESA, flow: "push", instructions: push("M-Pesa"), minAmount: 10 },
    { ...AIRTEL, flow: "push", instructions: push("Airtel Money"), minAmount: 10 },
    { ...AFRICELL, flow: "push", instructions: push("Afrimoney"), minAmount: 100 },
  ],
  SN: [
    { ...ORANGE, flow: "redirect", instructions: ligdicashPage("Orange Money") },
    { ...WAVE, flow: "redirect", instructions: ligdicashPage("Wave") },
    // « Free Sénégal » chez LigdiCash : Free Money est devenu Mixx by Yas.
    { ...YAS, flow: "redirect", instructions: ligdicashPage("Mixx by Yas") },
  ],
  TG: [
    { ...MOOV, flow: "push", instructions: push("Moov Money"), minAmount: 100 },
    { ...YAS, flow: "push", instructions: push("Mixx by Yas"), minAmount: 100 },
  ],
};

/** Code USSD qui génère le code de paiement, montant compris : « *144*4*6# » et 500 FCFA donnent
 *  « *144*4*6*500# » — le client n'a plus qu'à valider ; sans montant valide, le code tel quel. */
export function otpUssdWithAmount(code: string, amount: number): string {
  if (!code || !Number.isInteger(amount) || amount <= 0) return code;
  return code.replace(/#$/, `*${amount}#`);
}

/** Raison pour laquelle ce montant n'est pas accepté par cet opérateur ; null s'il l'est. */
export function mobileMoneyAmountError(operator: Pick<MobileMoneyOperator, "label" | "minAmount" | "maxAmount"> | null, amount: number): string | null {
  const min = Math.max(DIRECT_DEPOSIT_MIN_AMOUNT, operator?.minAmount ?? 0);
  const max = Math.min(DIRECT_DEPOSIT_MAX_AMOUNT, operator?.maxAmount ?? Infinity);
  const fcfa = (value: number) => `${value.toLocaleString("fr-FR")} FCFA`;
  if (!Number.isFinite(amount) || amount < min) return `Montant minimum${operator && min > DIRECT_DEPOSIT_MIN_AMOUNT ? ` avec ${operator.label}` : ""} : ${fcfa(min)}.`;
  if (amount > max) return `Montant maximum${operator && max < DIRECT_DEPOSIT_MAX_AMOUNT ? ` avec ${operator.label}` : ""} : ${fcfa(max)}.`;
  return null;
}

/** YengaPay : Orange Money et Moov Money, mêmes opérateurs partout (intégration d'origine). */
const YENGAPAY_OPERATORS: readonly MobileMoneyOperator[] = [
  { ...ORANGE, flow: "otp_ussd", instructions: "Composez le code indiqué pour obtenir votre code OTP, puis saisissez-le ici." },
  { ...MOOV, flow: "otp_ussd", instructions: "Saisissez le code OTP reçu par SMS." },
];

export type DirectPaymentProvider = "yengapay" | "ligdicash";

/** Opérateurs proposés à un utilisateur de ce pays, chez ce prestataire (liste vide : pas de rechargement). */
export function mobileMoneyOperatorsFor(provider: DirectPaymentProvider, countryCode: string | null | undefined): readonly MobileMoneyOperator[] {
  if (provider === "yengapay") return YENGAPAY_OPERATORS;
  return LIGDICASH_OPERATORS[(countryCode ?? "").toUpperCase()] ?? [];
}

export function findMobileMoneyOperator(provider: DirectPaymentProvider, countryCode: string | null | undefined, operator: string): MobileMoneyOperator | null {
  return mobileMoneyOperatorsFor(provider, countryCode).find((item) => item.id === operator) ?? null;
}

const LABELS: Record<MobileMoneyOperatorId, string> = {
  orange_money: ORANGE.label, moov_money: MOOV.label, mtn_money: MTN.label, wave: WAVE.label, airtel_money: AIRTEL.label, yas_money: YAS.label,
  zamani_money: ZAMANI.label, free_money: "Free Money", vodacom_mpesa: MPESA.label, africell_money: AFRICELL.label,
};

export function mobileMoneyOperatorLabel(operator: string): string {
  return LABELS[operator as MobileMoneyOperatorId] ?? operator;
}
