/**
 * L'état de vérification d'un profil, tel qu'il est réellement.
 *
 * La page de profil portait une pastille « LIVREUR VÉRIFIÉ » écrite en dur :
 * elle s'affichait pour tout le monde, documents envoyés ou non. Et la ligne
 * « Vérification d'identité » lisait le nombre d'avis reçus pour décider
 * d'afficher « Validé » — un livreur avec quatre avis passait pour vérifié même
 * après un refus, un livreur vérifié sans avis lisait « Soumettez vos
 * documents ». Pendant ce temps `trpc.kyc.status` existait et aucun écran ne
 * l'interrogeait.
 *
 * Cette fonction est la seule à décider, à partir de ce que le serveur répond.
 */

/** Ce que renvoie `kyc.status` : le dernier dossier, ou rien s'il n'y en a pas. */
export type KycSubmissionStatus = "submitted" | "approved" | "rejected";

export type ProfileVerification = {
  /** Le registre de couleur, sans dire laquelle : c'est au rendu de choisir. */
  tone: "verified" | "pending" | "blocked";
  /** Où mène le bandeau : l'éditeur de photo, ou l'écran des pièces d'identité. */
  target: "photo" | "kyc";
  title: string;
  detail?: string;
  /** Le libellé de l'action à proposer, quand il y en a une. */
  action?: string;
};

export type VerificationInput = {
  role: "sender" | "driver";
  hasPhoto: boolean;
  kycStatus: KycSubmissionStatus | null | undefined;
  submittedAt?: string | null;
  rejectionReason?: string | null;
};

function onDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return "";
  return ` le ${time.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}`;
}

/**
 * L'état à afficher, ou `null` quand il n'y a rien à dire. Un expéditeur ne
 * passe pas de vérification d'identité : lui montrer un bandeau vide ou, pire,
 * un « vérifié » de complaisance, ne lui apprend rien.
 */
export function profileVerification(input: VerificationInput): ProfileVerification | null {
  if (input.role !== "driver") return null;

  // La photo passe avant le dossier : sans elle, l'accueil refuse déjà de
  // laisser candidater, quel que soit l'état du KYC.
  if (!input.hasPhoto) {
    return {
      tone: "blocked",
      target: "photo",
      title: "Photo de profil manquante",
      detail: "Les expéditeurs voient votre photo au moment de choisir un livreur.",
      action: "Ajouter ma photo",
    };
  }

  if (input.kycStatus === "approved") {
    return { tone: "verified", target: "kyc", title: `Identité vérifiée${onDate(input.submittedAt)}` };
  }
  if (input.kycStatus === "submitted") {
    return {
      tone: "pending",
      target: "kyc",
      title: `Documents envoyés${onDate(input.submittedAt)}`,
      detail: "Vérification en cours. Vous pouvez déjà candidater aux courses.",
    };
  }
  if (input.kycStatus === "rejected") {
    return {
      tone: "blocked",
      target: "kyc",
      title: "Documents refusés",
      detail: input.rejectionReason?.trim() || "Reprenez vos photos et renvoyez votre dossier.",
      action: "Renvoyer mes documents",
    };
  }
  return {
    tone: "blocked",
    target: "kyc",
    title: "Identité non vérifiée",
    detail: "Vos pièces d’identité sont nécessaires pour candidater aux courses.",
    action: "Envoyer mes documents",
  };
}
