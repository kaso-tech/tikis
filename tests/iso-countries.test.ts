import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COUNTRIES, DEFAULT_COUNTRY, findCountryForPhone, formatLocalPhone, isValidInternationalPhone } from "../lib/registration-rules";
import { countryDraftIssue, countryNameMatches, countryPlanWarning, ISO_COUNTRIES, isoCountry, isoCountryByName } from "../shared/iso-countries";
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

describe("plans de numérotation du Bénin et du Niger", () => {
  const benin = COUNTRIES.find((country) => country.id === "BJ")!;
  const niger = COUNTRIES.find((country) => country.id === "NE")!;

  it("propose les deux pays à l’inscription", () => {
    expect(benin).toMatchObject({ name: "Bénin", dialCode: "+229", digits: 10 });
    expect(niger).toMatchObject({ name: "Niger", dialCode: "+227", digits: 8 });
    // Les ajouter en tête ne doit pas déplacer le pays par défaut.
    expect(DEFAULT_COUNTRY.id).toBe("BF");
  });

  it("accepte un numéro béninois, qui commence par zéro depuis la renumérotation", () => {
    // La règle « premier chiffre non nul » rejetait tous les numéros du Bénin.
    expect(isValidInternationalPhone("0197000000", benin)).toBe(true);
    expect(isValidInternationalPhone("0166112233", benin)).toBe(true);
    expect(formatLocalPhone("0197000000", benin)).toBe("01 97 00 00 00");
  });

  it("refuse toujours un numéro trop court, ou fait de zéros", () => {
    expect(isValidInternationalPhone("97000000", benin)).toBe(false);
    expect(isValidInternationalPhone("0000000000", benin)).toBe(false);
  });

  it("garde la règle stricte là où le plan ne commence pas par zéro", () => {
    expect(isValidInternationalPhone("90000000", niger)).toBe(true);
    expect(isValidInternationalPhone("09000000", niger)).toBe(false);
    expect(formatLocalPhone("90112233", niger)).toBe("90 11 22 33");
  });

  it("reconnaît les deux indicatifs, sans les confondre avec un autre pays", () => {
    expect(findCountryForPhone("+2290197000000").id).toBe("BJ");
    expect(findCountryForPhone("+22790112233").id).toBe("NE");
    expect(findCountryForPhone("+2347012345678").id).not.toBe("NE");
  });

  it("avertit sans bloquer quand le nombre de chiffres ne suit pas le plan connu", () => {
    const warning = countryPlanWarning({ id: "BJ", name: "Bénin", dialCode: "+229", digits: 8 });
    expect(warning).toContain("10 chiffres, pas 8");
    expect(warning).toContain("novembre 2024");
    expect(countryPlanWarning({ id: "BJ", name: "Bénin", dialCode: "+229", digits: 10 })).toBeNull();
    // Un pays dont le plan n'est pas dans la référence ne déclenche rien.
    expect(countryPlanWarning({ id: "MA", name: "Maroc", dialCode: "+212", digits: 9 })).toBeNull();
  });

  it("signale un découpage inhabituel une fois la longueur juste", () => {
    expect(countryPlanWarning({ id: "NE", name: "Niger", dialCode: "+227", digits: 8, groups: [4, 4] }))
      .toContain("2,2,2,2");
  });

  it("l’application dérive la règle du zéro initial du pays, pas de la console", () => {
    const db = readFileSync(join(process.cwd(), "server/db.ts"), "utf8");
    expect(db).toContain("allowsLeadingZero: isoCountry(row.id)?.allowsLeadingZero");
  });
});
