import { sanitizePlaceText } from "./geo-rules";

export const PLACE_AUTOCOMPLETE_MIN_CHARS = 3;
export const PLACE_AUTOCOMPLETE_DEBOUNCE_MS = 420;

export function autocompleteQuery(value: string) {
  const query = sanitizePlaceText(value, 120);
  return query.length >= PLACE_AUTOCOMPLETE_MIN_CHARS ? query : null;
}

/** Évite une nouvelle écriture d’état lorsque la même liste de suggestions est déjà affichée. */
export function haveSameSuggestionIds<T extends { id?: string; mapboxId?: string }>(current: readonly T[], next: readonly T[]) {
  const identity = (place: T | undefined) => place?.id ?? place?.mapboxId ?? "";
  return current.length === next.length && current.every((place, index) => identity(place) === identity(next[index]));
}
