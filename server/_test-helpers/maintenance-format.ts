export const MAINTENANCE_DEFAULT_MESSAGE = "L’application Tikis est momentanément indisponible pour une amélioration du service. L’équipe technique travaille pour la rétablir. Merci de votre patience.";

export const MAINTENANCE_MESSAGE_MAX_LENGTH = 500;

export function formatMaintenanceUserMessage(customMessage: string | undefined | null): string {
  const trimmed = (customMessage ?? "").trim();
  if (!trimmed) return MAINTENANCE_DEFAULT_MESSAGE;
  if (trimmed.length > MAINTENANCE_MESSAGE_MAX_LENGTH) {
    return trimmed.slice(0, MAINTENANCE_MESSAGE_MAX_LENGTH);
  }
  return trimmed;
}
