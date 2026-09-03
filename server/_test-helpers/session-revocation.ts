const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Date d'expiration d'une loyalty_grant : grantedAt + 30 jours. */
export function computeSessionExpiry(grantedAt: Date): Date {
  return new Date(grantedAt.getTime() + THIRTY_DAYS_MS);
}

/** Au logout, on révoque uniquement la session courante. */
export function shouldRevokeOnLogout(input: { sessionId: string; isCurrent: boolean }): boolean {
  return input.isCurrent;
}
