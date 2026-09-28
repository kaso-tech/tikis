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

  it("intitule par sa ville un point dont on ne connaît rien de plus précis", () => {
    // Ce cas s'intitulait « Point sélectionné ». À la demande du produit, la ville sert de titre quand rien
    // de plus précis n'est connu : elle dit où est le point, « Point sélectionné » ne disait rien.
    const location = { name: "Ouagadougou", district: "", city: "Ouagadougou", formattedAddress: "Ouagadougou, Burkina Faso", latitude: 12.37, longitude: -1.52 };
    expect(locationTitle(location)).toBe("Ouagadougou");
    // Le sous-titre ne répète pas le titre : il retombe sur l'adresse complète.
    expect(locationSubtitle(location)).toBe("Ouagadougou, Burkina Faso");
  });

  it("ne garde « Point sélectionné » qu'en dernier recours, sans aucune donnée de lieu", () => {
    const nothingKnown = { name: "", district: "", city: "", latitude: 12.37, longitude: -1.52 };
    expect(locationTitle(nothingKnown)).toBe("Point sélectionné");
  });
});
