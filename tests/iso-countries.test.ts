import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COUNTRIES } from "../lib/registration-rules";
import { countryDraftIssue, countryNameMatches, ISO_COUNTRIES, isoCountry, isoCountryByName } from "../shared/iso-countries";
import { isCoordinateInCountry, listSupportedCountries } from "../server/_test-helpers/geo-fence";

describe("référence des codes pays", () => {
  it("connaît le Bénin et le Niger sous leur vrai code", () => {
    expect(isoCountry("BJ")).toMatchObject({ name: "Bénin", dialCode: "+229" });
    expect(isoCountry("NE")).toMatchObject({ name: "Niger", dialCode: "+227" });
  });

  it("ne confond pas les codes voisins de ces deux-là", () => {
    // Les deux erreurs qui ont été commises : BN est le Brunei, NG le Nigeria.
    expect(isoCountry("BN")).toBeUndefined();
    expect(isoCountry("NG")).toMatchObject({ name: "Nigeria", dialCode: "+234" });
    expect(isoCountryByName("Bénin")?.id).toBe("BJ");
    expect(isoCountryByName("Niger")?.id).toBe("NE");
  });

  it("n’a ni doublon de code ni doublon d’indicatif", () => {
    const codes = ISO_COUNTRIES.map((c) => c.id);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[A-Z]{2}$/);
    const dials = ISO_COUNTRIES.map((c) => c.dialCode);
    expect(new Set(dials).size).toBe(dials.length);
    for (const dial of dials) expect(dial).toMatch(/^\+\d{1,4}$/);
  });

  it("reconnaît un nom sans accent ni ponctuation", () => {
    expect(isoCountryByName("benin")?.id).toBe("BJ");
    expect(isoCountryByName("COTE D IVOIRE")?.id).toBe("CI");
    expect(isoCountryByName("Cabo Verde")?.id).toBe("CV");
    expect(isoCountryByName("cap-vert")?.id).toBe("CV");
  });

  it("ne tranche pas entre les deux Congo quand le nom est ambigu", () => {
    // « Congo » seul désignerait aussi bien Brazzaville que Kinshasa : mieux vaut
    // ne rien dire que corriger l'administrateur vers le mauvais des deux.
    expect(isoCountryByName("Congo")).toBeUndefined();
    expect(countryNameMatches("CD", "Congo")).toBe(true);
    expect(isoCountryByName("RDC")?.id).toBe("CD");
  });

  it("laisse passer une graphie locale qu’elle ne connaît pas", () => {
    expect(countryNameMatches("BF", "Burkina")).toBe(true);
  });
});

describe("cohérence d’un pays saisi dans la console", () => {
  it("accepte un pays juste", () => {
    expect(countryDraftIssue({ id: "BJ", name: "Bénin", dialCode: "+229" })).toBeNull();
    expect(countryDraftIssue({ id: "NE", name: "Niger", dialCode: "+227" })).toBeNull();
  });

  it("rattrape la confusion de code en nommant la correction", () => {
    expect(countryDraftIssue({ id: "BN", name: "Bénin", dialCode: "+229" }))
      .toBe("Le code ISO de « Bénin » est BJ, pas BN.");
    expect(countryDraftIssue({ id: "NG", name: "Niger", dialCode: "+227" }))
      .toBe("NG est le code de « Nigeria », pas de « Niger » — dont le code est NE.");
  });

  it("rattrape un indicatif qui ne va pas avec le pays", () => {
    expect(countryDraftIssue({ id: "NE", name: "Niger", dialCode: "+234" }))
      .toBe("L’indicatif de « Niger » est +227, pas +234.");
  });

  it("refuse un code de deux lettres qui ne désigne aucun pays desservi", () => {
    expect(countryDraftIssue({ id: "ZZ", name: "Pays test", dialCode: "+999" })).toContain("ZZ");
    expect(countryDraftIssue({ id: "B", name: "Bénin", dialCode: "+229" })).toContain("2 lettres");
  });
});

describe("ce que la confusion de code entraînait", () => {
  it("le géofencing connaît maintenant le Bénin et le Niger", () => {
    // Sans entrée, la bbox retombait sur toute l'Afrique de l'Ouest et du Centre :
    // aucune position aberrante n'était plus écartée.
    expect(isCoordinateInCountry(6.37, 2.39, "BJ")).toBe(true);   // Cotonou
    expect(isCoordinateInCountry(13.51, 2.11, "NE")).toBe(true);  // Niamey
    expect(isCoordinateInCountry(48.85, 2.35, "BJ")).toBe(false); // Paris
    expect(isCoordinateInCountry(4.05, 9.70, "NE")).toBe(false);  // Douala
  });

  it("chaque pays proposé à l’inscription a une bbox de géofencing", () => {
    // Sans bbox, `isCoordinateInCountry` accepte toute l'Afrique de l'Ouest et
    // du Centre : la protection existe, mais ne protège rien.
    const fenced = new Set(listSupportedCountries());
    for (const country of COUNTRIES) expect(fenced.has(country.id)).toBe(true);
  });

  it("le serveur refuse d’enregistrer un pays incohérent", () => {
    const adminDb = readFileSync(join(process.cwd(), "server/admin-db.ts"), "utf8");
    expect(adminDb).toContain("countryDraftIssue({ id: input.id, name: input.name, dialCode: input.dialCode })");
  });

  it("la console signale les lignes déjà enregistrées de travers", () => {
    const adminDb = readFileSync(join(process.cwd(), "server/admin-db.ts"), "utf8");
    expect(adminDb).toContain("issue: countryDraftIssue(");
    const page = readFileSync(join(process.cwd(), "admin/src/pages/CountriesPage.tsx"), "utf8");
    expect(page).toContain("country.issue");
  });

  it("la vérification de pays d’un lieu ne se saute plus pour un pays ajouté depuis la console", () => {
    const geography = readFileSync(join(process.cwd(), "server/geography.ts"), "utf8");
    expect(geography).toContain("countryNameMatches(known.id, place.country)");
  });
});
