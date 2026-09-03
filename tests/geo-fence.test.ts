import { describe, expect, it } from "vitest";
import { isCoordinateInCountry, listSupportedCountries } from "../server/_test-helpers/geo-fence";

describe("isCoordinateInCountry (geo-fence)", () => {
  it("Yaoundé est dans la bbox du Cameroun", () => {
    expect(isCoordinateInCountry(3.848, 11.502, "CM")).toBe(true);
  });

  it("Douala est dans la bbox du Cameroun", () => {
    expect(isCoordinateInCountry(4.061, 9.786, "CM")).toBe(true);
  });

  it("Paris est hors Cameroun", () => {
    expect(isCoordinateInCountry(48.857, 2.352, "CM")).toBe(false);
  });

  it("New York est hors Cameroun", () => {
    expect(isCoordinateInCountry(40.713, -74.006, "CM")).toBe(false);
  });

  it("Coordonnée au point 0,0 est rejetée", () => {
    expect(isCoordinateInCountry(0, 0, "CM")).toBe(false);
  });

  it("Coordonnées invalides sont rejetées", () => {
    expect(isCoordinateInCountry(Number.NaN, 0, "CM")).toBe(false);
    expect(isCoordinateInCountry(0, Number.POSITIVE_INFINITY, "CM")).toBe(false);
  });

  it("Pays inconnu utilise la bbox par défaut (Afrique large)", () => {
    expect(isCoordinateInCountry(5, 5, "ZZ")).toBe(true);
    expect(isCoordinateInCountry(60, 5, "ZZ")).toBe(false);
  });

  it("Code pays en minuscule est accepté (insensible à la casse)", () => {
    expect(isCoordinateInCountry(3.848, 11.502, "cm")).toBe(true);
  });

  it("Côte d'Ivoire est supportée", () => {
    expect(isCoordinateInCountry(5.36, -4.0, "CI")).toBe(true);
  });

  it("Sénégal est supporté", () => {
    expect(isCoordinateInCountry(14.7, -17.5, "SN")).toBe(true);
  });

  it("listSupportedCountries retourne au moins 3 pays", () => {
    expect(listSupportedCountries().length).toBeGreaterThanOrEqual(3);
    expect(listSupportedCountries()).toContain("CM");
  });
});
