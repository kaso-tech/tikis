import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const wallet = readFileSync(join(process.cwd(), "components/tikis/wallet-direct-deposit.tsx"), "utf8");
const profile = readFileSync(join(process.cwd(), "app/(tabs)/profile.tsx"), "utf8");
const router = readFileSync(join(process.cwd(), "server/routers.ts"), "utf8");
const geography = readFileSync(join(process.cwd(), "server/geography.ts"), "utf8");

describe("cohérence pays et ville du profil", () => {
  it("utilise le pays enregistré du profil pour le paiement direct", () => {
    expect(wallet).toContain("profileStatusQuery.data?.country ?? profile?.country");
    expect(wallet).toContain("const fromProfile = COUNTRIES.find((c) => c.id === profileCountry)");
    expect(wallet).not.toContain("profile?.countryCode");
  });

  it("efface la ville locale lorsque le pays du profil change", () => {
    expect(profile).toContain("updateProfile({ country: saved.country, city: saved.city ?? undefined })");
    expect(router).toContain("const countryChanged = Boolean(input.country && input.country !== current.country)");
    expect(router).toContain("const nextCity = countryChanged ? null : input.city ?? current.city");
  });

  it("valide côté serveur qu’une ville appartient au pays choisi", () => {
    expect(router).toContain("geography.cityBelongsToCountry(input.city, nextCountry)");
    expect(router).toContain("Cette ville n’appartient pas au pays sélectionné.");
    expect(geography).toContain("export async function cityBelongsToCountry");
    expect(geography).toContain("searchCities(city, countryCode)");
  });
});
