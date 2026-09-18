import { describe, expect, it } from "vitest";

import { displayLocation, locationSubtitle, locationTitle } from "../shared/tikis-domain";

describe("libellés d’adresse Tikis", () => {
  /**
   * Ce cas attendait la rue au premier plan. La logique métier des lieux
   * (§7.1) place le quartier avant la rue : dans une liste, « Koulouba » se
   * comprend immédiatement là où « Avenue Kwame Nkrumah » demande un effort.
   * La rue ne disparaît pas, elle passe en second rang.
   */
  it("met le quartier au premier plan et garde la rue en second, sans répéter la ville", () => {
    const location = { name: "Ouagadougou", district: "Koulouba", city: "Ouagadougou", street: "Avenue Kwame Nkrumah", formattedAddress: "Avenue Kwame Nkrumah, Koulouba, Ouagadougou", latitude: 12.3698, longitude: -1.5202 };
    expect(locationTitle(location)).toBe("Koulouba");
    expect(locationSubtitle(location)).toBe("Avenue Kwame Nkrumah · Ouagadougou");
    expect(displayLocation(location)).toBe("Koulouba · Avenue Kwame Nkrumah · Ouagadougou");
  });

  it("garde la rue au premier plan quand aucun quartier n’est connu", () => {
    const location = { name: "Ouagadougou", district: "", city: "Ouagadougou", street: "Avenue Kwame Nkrumah", formattedAddress: "Avenue Kwame Nkrumah, Ouagadougou", latitude: 12.3698, longitude: -1.5202 };
    expect(locationTitle(location)).toBe("Avenue Kwame Nkrumah");
  });

  it("distingue clairement un point sans adresse officielle", () => {
    const location = { name: "Ouagadougou", district: "", city: "Ouagadougou", formattedAddress: "Ouagadougou, Burkina Faso", latitude: 12.37, longitude: -1.52 };
    expect(locationTitle(location)).toBe("Point sélectionné");
    expect(locationSubtitle(location)).toBe("Ouagadougou");
  });
});
