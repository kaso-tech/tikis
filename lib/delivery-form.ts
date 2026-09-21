/**
 * Les deux décisions que prenait l'écran de publication à sa façon.
 *
 * La première : ce qui manque encore. Une barre de progression annonçait un
 * pourcentage calculé sur cinq champs alors qu'elle en comptait six, et
 * comptait les consignes, qui sont facultatives. Elle affichait donc 100 % sur
 * une course impubliable, et 80 % sur une course prête. Un pourcentage ne dit
 * de toute façon pas quoi faire : une phrase qui nomme le champ manquant, si.
 *
 * La seconde : l'engin. Il se choisissait avant le colis, alors qu'il en
 * dépend — on ne met pas quatre-vingts kilos sur un vélo. Il suit désormais ce
 * qui est transporté, tant que l'expéditeur ne l'a pas fixé lui-même.
 */

import type { DeliveryType, SelectableVehicleType } from "@/shared/tikis-domain";

export type PublicationState = {
  pickup: boolean;
  dropoff: boolean;
  route: boolean;
  title: string;
  titleReady: boolean;
  deliveryType: DeliveryType;
  passengers: string;
  measurementIssue: string | null | undefined;
  offeredPrice: string;
  priceError: string | null | undefined;
};

/**
 * Ce qui empêche de publier, dans l'ordre où l'écran le demande, ou `null`
 * quand plus rien ne manque. Un seul point à la fois : une liste de tout ce qui
 * reste se lit comme un reproche.
 */
export function publicationBlocker(state: PublicationState): string | null {
  if (!state.pickup) return "Choisissez le lieu de récupération.";
  if (!state.dropoff) return "Choisissez la destination.";
  if (!state.route) return "Calcul de l’itinéraire en cours…";
  if (!state.title.trim()) return "Donnez un titre à la course.";
  if (!state.titleReady) return "Le titre contient des caractères non autorisés.";
  if (state.deliveryType === "Personne") {
    const count = Number(state.passengers);
    if (!count || count > 4) return "Indiquez entre 1 et 4 personnes.";
  }
  if (state.measurementIssue) return state.measurementIssue;
  if (state.priceError) return state.priceError;
  if (!state.offeredPrice.trim()) return "Fixez le prix que vous proposez.";
  return null;
}

/**
 * L'engin que le colis appelle. Le vélo n'y figure jamais : c'est un choix
 * d'expéditeur, pas une conséquence du poids.
 */
export function suggestVehicle(input: {
  deliveryType: DeliveryType;
  weightKg: string;
  passengers: string;
}): SelectableVehicleType {
  if (input.deliveryType === "Personne") {
    return Number(input.passengers) > 2 ? "Voiture" : "Moto";
  }
  if (input.deliveryType === "Autre") {
    const weight = Number(input.weightKg);
    if (Number.isFinite(weight) && weight > 80) return "Voiture";
    if (Number.isFinite(weight) && weight > 25) return "Tricycle";
  }
  return "Moto";
}
