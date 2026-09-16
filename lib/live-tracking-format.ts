/**
 * Mise en forme de l'écran de suivi en direct.
 *
 * Tout ce qui est calculable sans React vit ici : l'âge du signal GPS, l'heure
 * d'arrivée en horloge et les jalons horodatés. Le composant natif ne fait plus
 * que rendre ces valeurs, et vitest peut les vérifier sans dépendance
 * React Native.
 */

import type { DeliveryStatus } from "@/shared/tikis-domain";

/** Au-delà de ce délai, la dernière position connue n'est plus « en direct ». */
export const SIGNAL_STALE_AFTER_MS = 60_000;

export type SignalFreshness = {
  /** `live` = position fraîche, `weak` = position vieillissante, `none` = jamais reçue. */
  state: "live" | "weak" | "none";
  /** « En direct », « Signal faible » ou « Signal en attente ». */
  label: string;
  /** « il y a 4 s » — vide tant qu'aucune position n'est arrivée. */
  age: string;
};

function parseDate(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1_000));
  if (seconds < 60) return `il y a ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `il y a ${hours} h`;
}

/** L'âge réel du dernier point GPS. Une pastille qui dit « en direct » sur une
 *  position de dix minutes ment à l'expéditeur : au-delà d'une minute on le dit. */
export function describeSignalFreshness(recordedAt: string | Date | null | undefined, now: number = Date.now()): SignalFreshness {
  const recorded = parseDate(recordedAt);
  if (recorded === null) return { state: "none", label: "Signal en attente", age: "" };
  const age = Math.max(0, now - recorded);
  if (age < SIGNAL_STALE_AFTER_MS) return { state: "live", label: "En direct", age: formatAge(age) };
  return { state: "weak", label: "Signal faible", age: formatAge(age) };
}

/** « 14:32 ». Une heure d'arrivée se planifie, un compte à rebours se subit :
 *  l'écran affiche les deux, l'horloge en premier. */
export function formatClockTime(value: Date | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** Heure d'arrivée = maintenant + ETA. Calcul côté client : le serveur ne
 *  renvoie qu'une durée, on ne lui ajoute pas une horloge à maintenir. */
export function arrivalClockTime(etaMinutes: number, now: number = Date.now()): string | null {
  if (!Number.isFinite(etaMinutes) || etaMinutes <= 0) return null;
  return formatClockTime(now + etaMinutes * 60_000);
}

/** « dans 9 min », « dans 1 h 05 ». */
export function formatCountdown(etaMinutes: number): string | null {
  if (!Number.isFinite(etaMinutes) || etaMinutes <= 0) return null;
  if (etaMinutes < 60) return `dans ${Math.round(etaMinutes)} min`;
  const hours = Math.floor(etaMinutes / 60);
  const minutes = Math.round(etaMinutes % 60);
  return minutes === 0 ? `dans ${hours} h` : `dans ${hours} h ${minutes.toString().padStart(2, "0")}`;
}

export type MilestoneKey = "published" | "assigned" | "active" | "completed";
export type MilestoneState = "done" | "current" | "pending";

export type Milestone = {
  key: MilestoneKey;
  label: string;
  /** « 13:58 », ou `null` si le jalon n'a pas encore eu lieu. */
  time: string | null;
  state: MilestoneState;
};

export type MilestoneSource = {
  status: DeliveryStatus;
  createdAt?: string | Date | null;
  selectedAt?: string | Date | null;
  confirmedAt?: string | Date | null;
  completedAt?: string | Date | null;
};

/** Rang du statut dans la frise. `draft` et `open` sont au même point : la
 *  course est publiée, personne ne l'a prise. */
export function milestoneIndex(status: DeliveryStatus): number {
  if (status === "pending_confirmation") return 1;
  if (status === "active") return 2;
  if (status === "completed") return 3;
  return 0;
}

/** Les quatre statuts métier réels, chacun avec l'heure à laquelle il s'est
 *  produit. Une frise sans horaires n'apprend rien qu'on ne voie déjà. */
export function buildMilestones(delivery: MilestoneSource): Milestone[] {
  const reached = milestoneIndex(delivery.status);
  const stamps: { key: MilestoneKey; label: string; at: string | Date | null | undefined }[] = [
    { key: "published", label: "Publiée", at: delivery.createdAt },
    { key: "assigned", label: "Attribuée", at: delivery.selectedAt },
    { key: "active", label: "En cours", at: delivery.confirmedAt },
    { key: "completed", label: "Livrée", at: delivery.completedAt },
  ];
  return stamps.map((stamp, index) => {
    const at = parseDate(stamp.at);
    const state: MilestoneState = index < reached ? "done" : index === reached ? "current" : "pending";
    return {
      key: stamp.key,
      label: stamp.label,
      // Un horaire futur n'existe pas : on ne date que les jalons déjà franchis.
      time: at !== null && index <= reached ? formatClockTime(at) : null,
      state,
    };
  });
}

/** Le titre que porte le sheet, au statut réel de la course. */
export function trackingStatusLabel(status: DeliveryStatus, hasDriver: boolean): string {
  if (status === "active") return hasDriver ? "EN ROUTE VERS LA RÉCUPÉRATION" : "COURSE EN COURS";
  if (status === "pending_confirmation") return "EN ATTENTE DE CONFIRMATION";
  if (status === "completed") return "COURSE LIVRÉE";
  if (status === "open") return "EN ATTENTE D'UN LIVREUR";
  return "COURSE INACTIVE";
}

/** La référence courte affichée à l'expéditeur — les huit premiers caractères
 *  de l'identifiant, comme sur la fiche livraison. */
export function deliveryReference(id: string | null | undefined): string {
  if (!id) return "—";
  return id.slice(0, 8).toUpperCase();
}
