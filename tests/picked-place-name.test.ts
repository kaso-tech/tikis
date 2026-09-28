import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { locationTitle, withMeaningfulName } from "../lib/geo-rules";
import type { LocationLabel } from "../shared/tikisse-domain";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

// Ce que le géocodage inverse renvoie pour un point sans lieu public : le cas de la capture d'écran.
const reverse = (overrides: Partial<LocationLabel>): LocationLabel => ({
  name: "Point sélectionné", district: "", city: "", latitude: 13.03, longitude: -2.05, source: "reverse", ...overrides,
});

describe("le lieu validé porte un vrai nom, plus « Point sélectionné »", () => {
  it("prend le quartier quand il est connu", () => {
    const place = withMeaningfulName(reverse({ district: "Bingo", city: "Arbollé", province: "Passoré" }));
    expect(place.name).toBe("Bingo");
  });

  it("prend la rue, faute de quartier", () => {
    expect(withMeaningfulName(reverse({ street: "Rue 23.02", city: "Ouagadougou" })).name).toBe("Rue 23.02");
  });

  it("prend la ville, faute de mieux", () => {
    expect(withMeaningfulName(reverse({ city: "Bingo", province: "Passoré" })).name).toBe("Bingo");
  });

  it("ne touche pas un lieu qui a déjà un vrai nom", () => {
    const poi = reverse({ name: "Maison du Peuple", district: "Koulouba", city: "Ouagadougou", featureType: "poi" });
    expect(withMeaningfulName(poi)).toBe(poi);
  });

  it("garde « Point sélectionné » seulement quand il n'y a vraiment rien d'autre", () => {
    expect(withMeaningfulName(reverse({})).name).toBe("Point sélectionné");
  });

  it("le titre affiché et le nom enregistré disent la même chose", () => {
    const place = reverse({ district: "Bingo", city: "Arbollé" });
    expect(withMeaningfulName(place).name).toBe(locationTitle(place));
  });

  it("les deux sélecteurs de carte l'appliquent au lieu qu'ils transmettent", () => {
    // « Utiliser » et « Enregistrer » partent tous deux de ce lieu : c'est là qu'il faut le nommer.
    expect(read("components/tikisse/address-map-picker.native.tsx")).toContain("setPlace(result ? withMeaningfulName<LocationLabel>({ ...result,");
    expect(read("components/tikisse/address-map-picker.web.tsx")).toContain("setPlace(result ? withMeaningfulName(result) : null)");
  });

  it("la liste des brouillons affiche le titre du lieu, pas son nom brut", () => {
    const drafts = read("app/delivery-drafts.tsx");
    expect(drafts).toContain("draft.pickup ? locationTitle(draft.pickup)");
    expect(drafts).not.toContain("draft.pickup?.name");
  });
});
