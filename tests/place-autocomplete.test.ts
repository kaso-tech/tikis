import { describe, expect, it } from "vitest";
import { PLACE_AUTOCOMPLETE_DEBOUNCE_MS, autocompleteQuery } from "../lib/place-autocomplete";

describe("autocomplétion des lieux Tikis", () => {
  it("attend un terme significatif et assainit la requête avant Places", () => {
    expect(PLACE_AUTOCOMPLETE_DEBOUNCE_MS).toBeGreaterThanOrEqual(300);
    expect(autocompleteQuery("Ou")).toBeNull();
    expect(autocompleteQuery("  <Ouaga 2000>  ")).toBe("Ouaga 2000");
  });
});
