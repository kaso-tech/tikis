/** Score combiné (0-100) pour la hauteur de barre d'un mois dans la tendance analytics.
 *  Pondération : 70% nombre de courses + 30% montant dépensé, normalisé par les max. */
export function trendBarValue(month: { deliveriesCount: number; totalSpent: number }, max: { deliveriesCount: number; totalSpent: number }): number {
  if (max.deliveriesCount <= 0 && max.totalSpent <= 0) return 0;
  const countRatio = max.deliveriesCount > 0 ? month.deliveriesCount / max.deliveriesCount : 0;
  const totalRatio = max.totalSpent > 0 ? month.totalSpent / max.totalSpent : 0;
  return Math.round((countRatio * 0.7 + totalRatio * 0.3) * 100);
}
