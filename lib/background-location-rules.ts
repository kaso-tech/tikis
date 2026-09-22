/**
 * Logique pure du suivi en arrière-plan, séparée de lib/background-location-task.ts
 * (qui importe expo-location/expo-task-manager) pour rester exécutable hors du
 * bundler natif — cf. le même découpage sur lib/route-refresh.ts.
 */

/** L'iOS renvoie -1 pour un cap non disponible (CLLocationDirection invalide) ; le schéma
 *  serveur exige [0, 360]. Publier 0 plutôt que de rejeter le point entier : la position
 *  prime sur le cap. */
export function safeHeading(heading: number | null | undefined): number {
  return typeof heading === "number" && Number.isFinite(heading) && heading >= 0 && heading <= 360 ? heading : 0;
}
