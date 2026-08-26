import { sanitizePlaceText } from "./geo-rules";

export const PLACE_AUTOCOMPLETE_MIN_CHARS = 3;
export const PLACE_AUTOCOMPLETE_DEBOUNCE_MS = 420;

export function autocompleteQuery(value: string) {
  const query = sanitizePlaceText(value, 120);
  return query.length >= PLACE_AUTOCOMPLETE_MIN_CHARS ? query : null;
}
