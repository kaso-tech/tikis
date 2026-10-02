/**
 * Opérateurs Mobile Money proposés pour recharger le Wallet, pays par pays, et la façon dont chacun fait
 * valider le paiement. Une seule table, lue par le serveur (opérateurs acceptés, parcours de paiement) et par
 * l'application (opérateurs affichés selon le pays du profil, consignes).
 *
 * LigdiCash — d'après sa documentation du paiement sans redirection
 * (developers.ligdicash.com/api-paiement/payin-sans-redirect/operateurs/…) :
 *  - otp_ussd    : le client obtient un code en composant un code USSD, le saisit dans l'application ;
 *                  une seule demande part alors, avec ce code (Orange Burkina) ;
 *  - push        : la demande part tout de suite ; l'opérateur affiche une fenêtre sur le téléphone du client,
 *                  qui valide avec son code PIN (Moov, Airtel, YAS) ;
 *  - guided_ussd : la demande part tout de suite ; l'opérateur envoie un SMS avec un code USSD à composer,
 *                  puis le client valide avec son code PIN (MTN Côte d'Ivoire) ;
 *  - redirect    : la demande part tout de suite ; LigdiCash renvoie l'adresse d'une page de paiement à ouvrir
 *                  (Orange Mali : portail Orange Money ; Wave Sénégal : page LigdiCash).
 * Un opérateur absent de la table n'est pas proposé : ajouter un pays ou un opérateur se fait ici seulement.
 */

export type MobileMoneyOperatorId = "orange_money" | "moov_money" | "mtn_money" | "wave" | "airtel_money" | "yas_money";
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
};

export const MOBILE_MONEY_OPERATOR_IDS = ["orange_money", "moov_money", "mtn_money", "wave", "airtel_money", "yas_money"] as const satisfies readonly MobileMoneyOperatorId[];

const ORANGE = { id: "orange_money", label: "Orange Money", short: "OM", color: "#C96900" } as const;
const MOOV = { id: "moov_money", label: "Moov Money", short: "MV", color: "#0033A0" } as const;
const MTN = { id: "mtn_money", label: "MTN MoMo", short: "MTN", color: "#B58900" } as const;
const WAVE = { id: "wave", label: "Wave", short: "WV", color: "#1A73C9" } as const;
const AIRTEL = { id: "airtel_money", label: "Airtel Money", short: "AM", color: "#C8102E" } as const;
const YAS = { id: "yas_money", label: "YAS (Mixx)", short: "YAS", color: "#5B2C83" } as const;

const pushInstructions = (operator: string) =>
  `Une demande de paiement s'affiche sur votre téléphone : validez-la avec votre code PIN ${operator}. Si rien ne s'affiche après une minute, ouvrez le menu ${operator} de votre téléphone : la demande y attend votre validation.`;

/** LigdiCash : opérateurs par pays (code ISO du profil). */
export const LIGDICASH_OPERATORS: Readonly<Record<string, readonly MobileMoneyOperator[]>> = {
  BF: [
    { ...ORANGE, flow: "otp_ussd", otpUssd: "*144*4*6#", instructions: "Composez *144*4*6# sur votre téléphone Orange Money pour obtenir votre code de paiement, puis saisissez-le ici." },
    { ...MOOV, flow: "push", instructions: pushInstructions("Moov Money") },
  ],
  CI: [
    { ...MTN, flow: "guided_ussd", instructions: "Vous allez recevoir un SMS de MTN avec un code USSD : composez-le, puis confirmez avec votre code PIN MoMo." },
    { ...MOOV, flow: "push", instructions: pushInstructions("Moov Money") },
  ],
  BJ: [
    { ...MOOV, flow: "push", instructions: pushInstructions("Moov Money") },
  ],
  TG: [
    { ...MOOV, flow: "push", instructions: pushInstructions("Moov Money") },
    { ...YAS, flow: "push", instructions: pushInstructions("YAS (Mixx)") },
  ],
  NE: [
    { ...AIRTEL, flow: "push", instructions: pushInstructions("Airtel Money") },
  ],
  ML: [
    { ...ORANGE, flow: "redirect", instructions: "Ouvrez la page de paiement Orange Money et suivez les étapes : votre Wallet est crédité dès la confirmation." },
  ],
  SN: [
    { ...WAVE, flow: "redirect", instructions: "Ouvrez la page de paiement Wave et validez le paiement : votre Wallet est crédité dès la confirmation." },
  ],
};

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
};

export function mobileMoneyOperatorLabel(operator: string): string {
  return LABELS[operator as MobileMoneyOperatorId] ?? operator;
}
