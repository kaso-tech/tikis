/**
 * Les trois montants proposés à l'expéditeur sous son champ de prix.
 *
 * Fixer un prix de sa propre initiative est la partie du formulaire qui bloque :
 * l'estimation s'affichait juste au-dessus du champ, et il fallait quand même
 * la recopier à la main. Les trois raccourcis donnent l'estimation telle quelle
 * et deux majorations, qui ne sont pas décoratives : le serveur remonte les
 * courses les mieux payées en tête de la liste des livreurs
 * (`shared/driver-opportunities.ts`).
 *
 * Les montants sont arrondis vers le haut à un pas lisible — de mémoire, on
 * propose 3 500 F, pas 3 450 F. Le pas suit l'ordre de grandeur : en dessous de
 * 2 000 F, arrondir au demi-millier collerait +50 % à une petite course.
 */

/** Les deux majorations proposées, en plus de l'estimation elle-même. */
const MARKUPS = [0.15, 0.3];

/** Le seuil au-delà duquel les montants s'arrondissent au demi-millier. */
const COARSE_STEP_FROM = 2_000;

export type PriceSuggestion = {
  amount: number;
  /** Écart à l'estimation, en pourcentage entier. Vaut 0 pour l'estimation elle-même. */
  markupPercent: number;
};

function roundUpTo(value: number, step: number) {
  return Math.ceil(value / step) * step;
}

export function priceSuggestionStep(estimate: number) {
  return estimate < COARSE_STEP_FROM ? 100 : 500;
}

export function priceSuggestions(estimate: number): PriceSuggestion[] {
  if (!Number.isFinite(estimate) || estimate <= 0) return [];
  const step = priceSuggestionStep(estimate);
  const suggestions: PriceSuggestion[] = [{ amount: Math.round(estimate), markupPercent: 0 }];
  for (const markup of MARKUPS) {
    const amount = roundUpTo(estimate * (1 + markup), step);
    // Un arrondi peut ramener une majoration sur la précédente : mieux vaut deux
    // raccourcis distincts que trois boutons dont deux font la même chose.
    if (amount <= suggestions[suggestions.length - 1].amount) continue;
    suggestions.push({ amount, markupPercent: Math.round(((amount - estimate) / estimate) * 100) });
  }
  return suggestions;
}
