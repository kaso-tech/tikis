import { describe, expect, it } from "vitest";

import { displayLocation, locationSubtitle, locationTitle } from "../shared/tikis-domain";

describe("libellés d’adresse Tikis", () => {
  it("met une adresse ou une rue au premier plan sans répéter la ville", () => {
    const location = { name: "Ouagadougou", district: "Koulouba", city: "Ouagadougou", street: "Avenue Kwame Nkrumah", formattedAddress: "Avenue Kwame Nkrumah, Koulouba, Ouagadougou", latitude: 12.3698, longitude: -1.5202 };
    expect(locationTitle(location)).toBe("Avenue Kwame Nkrumah");
    expect(locationSubtitle(location)).toBe("Koulouba · Ouagadougou");
    expect(displayLocation(location)).toBe("Avenue Kwame Nkrumah · Koulouba · Ouagadougou");
  });

  it("distingue clairement un point sans adresse officielle", () => {
    const location = { name: "Ouagadougou", district: "", city: "Ouagadougou", formattedAddress: "Ouagadougou, Burkina Faso", latitude: 12.37, longitude: -1.52 };
    expect(locationTitle(location)).toBe("Point sélectionné");
    expect(locationSubtitle(location)).toBe("Ouagadougou");
  });
});
