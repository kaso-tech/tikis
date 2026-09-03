/** Renvoie la date locale au format "YYYY-MM-DD". */
export function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Renvoie la date du jour au format "YYYY-MM-DD". */
export function getTodayDateString(): string {
  return getLocalDateString(new Date());
}
