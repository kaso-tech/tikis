/** Pure : % de progression arrondi, clampé à 100. Gère le seuil 0. */
export function computeProgressPercent(completedCount: number, requiredDeliveries: number): number {
  if (requiredDeliveries <= 0) return 100;
  const raw = (completedCount / requiredDeliveries) * 100;
  return Math.min(100, Math.round(raw));
}

/** Pure : message affiché dans la carte "Programme de fidélité" (UI mobile). */
export function formatRemainingMessage(input: { remaining: number; alreadyGranted: boolean; bonusAmount: number }): string {
  const formattedBonus = input.bonusAmount.toLocaleString("fr-FR");
  if (input.remaining > 0) {
    return `Plus que ${input.remaining} course${input.remaining > 1 ? "s" : ""} pour débloquer ${formattedBonus} FCFA`;
  }
  if (input.alreadyGranted) {
    return "🎁 Bonus en attente de validation par l’équipe";
  }
  return "Palier atteint !";
}
