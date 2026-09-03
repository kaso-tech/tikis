export type QualificationInput = {
  completedCount: number;
  requiredDeliveries: number;
  alreadyGranted: boolean;
};

/** Logique pure : détermine si la livraison qui vient d'être complétée déclenche le bonus.
 *  Déclenchement = exactement à la livraison-seuil ET pas déjà octroyé. */
export function determineJustQualified(input: QualificationInput): boolean {
  if (input.alreadyGranted) return false;
  if (input.completedCount < input.requiredDeliveries) return false;
  if (input.completedCount > input.requiredDeliveries) return false;
  return true;
}
