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

export type DeliveryDateInfo = {
  primary: string;
  icon: "schedule" | "history" | "fiber-new";
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

  const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  if (seconds < 60) return { primary: `Il y a ${seconds} sec`, icon: "fiber-new", tone: "primary" };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { primary: `Il y a ${minutes} min`, icon: "fiber-new", tone: "primary" };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { primary: `Il y a ${hours} h`, icon: "schedule", tone: "primary" };
  const days = Math.floor(hours / 24);
  if (days < 7) return { primary: `Il y a ${days} j`, icon: "history", tone: "muted" };
  return { primary: new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" }).format(new Date(timestamp)), icon: "history", tone: "muted" };
}
