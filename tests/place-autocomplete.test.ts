import { describe, expect, it } from "vitest";
import { PLACE_AUTOCOMPLETE_DEBOUNCE_MS, autocompleteQuery, haveSameSuggestionIds } from "../lib/place-autocomplete";

describe("autocomplétion des lieux Tikis", () => {
  it("attend un terme significatif et assainit la requête avant Places", () => {
    expect(PLACE_AUTOCOMPLETE_DEBOUNCE_MS).toBeGreaterThanOrEqual(300);
    expect(autocompleteQuery("Ou")).toBeNull();
    expect(autocompleteQuery("  <Ouaga 2000>  ")).toBe("Ouaga 2000");
  });

  it("évite de remplacer l’état par la même liste de suggestions", () => {
    const current = [{ mapboxId: "mapbox.1" }, { mapboxId: "mapbox.2" }];
    expect(haveSameSuggestionIds(current, [{ mapboxId: "mapbox.1" }, { mapboxId: "mapbox.2" }])).toBe(true);
    expect(haveSameSuggestionIds(current, [{ mapboxId: "mapbox.2" }, { mapboxId: "mapbox.1" }])).toBe(false);
  });
});
