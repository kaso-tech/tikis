const WEEKDAYS_LONG = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const WEEKDAYS_SHORT = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const MONTHS_LONG = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];
const MONTHS_SHORT = [
  "janv.", "févr.", "mars", "avr.", "mai", "juin",
  "juil.", "août", "sept.", "oct.", "nov.", "déc.",
];

export type FormattedDistance = { value: string; unit: "m" | "km" };

export function formatDistanceKm(km: number | null | undefined): FormattedDistance {
  if (km === null || km === undefined || !Number.isFinite(km) || km <= 0) {
    return { value: "—", unit: "km" };
  }
  if (km < 0.05) return { value: "< 50", unit: "m" };
  if (km < 1) return { value: `${Math.max(50, Math.round(km * 1000))}`, unit: "m" };
  if (km < 10) return { value: km.toFixed(1).replace(".", ","), unit: "km" };
  if (km < 100) return { value: km.toFixed(1).replace(".", ","), unit: "km" };
  return { value: Math.round(km).toString(), unit: "km" };
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function addDays(timestamp: number, days: number): number {
  const next = new Date(timestamp);
  next.setDate(next.getDate() + days);
  return next.getTime();
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}

export type DeliveryDateInfo = {
  /** Ligne principale, ex: "Publiée aujourd'hui à 14:30" ou "Publiée il y a 3 j" */
  primary: string;
  /** Icône MaterialIcons suggérée pour la card */
  icon: "schedule" | "history" | "fiber-new";
  /** Couleur d'accent: primary si récent, muted si plus vieux */
  tone: "primary" | "muted";
};

export function formatDeliveryCreationDate(value: string | null | undefined, now = Date.now()): DeliveryDateInfo {
  if (!value) {
    return { primary: "Date de publication indisponible", icon: "history", tone: "muted" };
  }
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return { primary: "Date de publication indisponible", icon: "history", tone: "muted" };
  }

  const todayStart = startOfDay(now);
  const yesterdayStart = addDays(todayStart, -1);
  const targetDayStart = startOfDay(timestamp);

  const diffMs = now - timestamp;
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / (24 * 3_600_000));

  const date = new Date(timestamp);
  const time = formatTime(timestamp);

  if (targetDayStart === todayStart) {
    if (diffMinutes < 1) return { primary: "Publiée à l'instant", icon: "fiber-new", tone: "primary" };
    if (diffMinutes < 60) return { primary: `Publiée il y a ${diffMinutes} min`, icon: "fiber-new", tone: "primary" };
    if (diffHours < 6) return { primary: `Publiée il y a ${diffHours} h`, icon: "schedule", tone: "primary" };
    return { primary: `Publiée aujourd'hui à ${time}`, icon: "schedule", tone: "primary" };
  }

  if (targetDayStart === yesterdayStart) {
    return { primary: `Publiée hier à ${time}`, icon: "schedule", tone: "muted" };
  }

  if (diffDays < 7) {
    const dayLabel = WEEKDAYS_LONG[date.getDay()];
    const capitalized = dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1);
    return { primary: `Publiée ${capitalized} ${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} à ${time}`, icon: "schedule", tone: "muted" };
  }

  if (date.getFullYear() === new Date(now).getFullYear()) {
    return { primary: `Publiée le ${date.getDate()} ${MONTHS_LONG[date.getMonth()]}`, icon: "history", tone: "muted" };
  }

  return { primary: `Publiée le ${date.getDate()} ${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`, icon: "history", tone: "muted" };
}
