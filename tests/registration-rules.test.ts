import { describe, expect, it } from "vitest";
import { COUNTRIES, createRegisteredProfile, detectCountry, findSimulatedAccount, formatLocalPhone, generateDriverReferralCode, isValidInternationalPhone, normalizedInternationalPhone, sanitizeFullName, validateFullName } from "../lib/registration-rules";

describe("règles d’inscription internationale Tikis", () => {
  const burkina = COUNTRIES.find((country) => country.id === "BF")!;
  const ivoryCoast = COUNTRIES.find((country) => country.id === "CI")!;

  it("détecte et applique le format de téléphone correspondant au pays", () => {
    expect(detectCountry("Africa/Ouagadougou").id).toBe("BF");
    expect(formatLocalPhone("70123456", burkina)).toBe("70 12 34 56");
    expect(formatLocalPhone("0701234567", ivoryCoast)).toBe("07 01 23 45 67");
    expect(normalizedInternationalPhone("70 12 34 56", burkina)).toBe("+22670123456");
    expect(isValidInternationalPhone("70 12 34 56", burkina)).toBe(true);
    expect(isValidInternationalPhone("70 12", burkina)).toBe(false);
  });

  it("identifie le compte de démonstration seulement après une vérification OTP réussie", () => {
    expect(findSimulatedAccount("+22670000000")?.fullName).toBe("Aïcha Traoré");
    expect(findSimulatedAccount("+22671111111")).toBeNull();
  });

  it("accepte un nom unique et normalise automatiquement les séparateurs", () => {
    expect(validateFullName("Mariam Ouédraogo").valid).toBe(true);
    expect(validateFullName("Mariam").valid).toBe(true);
    expect(validateFullName("<script>alert</script>").valid).toBe(false);
    expect(sanitizeFullName("  Mariam   Ouédraogo  ")).toBe("Mariam Ouédraogo");
    expect(sanitizeFullName("Mariam--Ouédraogo")).toBe("Mariam-Ouédraogo");
    expect(sanitizeFullName("Mariam - Ouédraogo")).toBe("Mariam Ouédraogo");
    expect(sanitizeFullName("Mariam' Ouédraogo")).toBe("Mariam'Ouédraogo");
  });

  it("verrouille le type de compte créé avec les engins du livreur", () => {
    const profile = createRegisteredProfile({ fullName: "Issa Sanou", phone: "+22671111111", role: "driver", vehicles: ["Vélo", "Moto"] });
    expect(profile.roleLocked).toBe(true);
    expect(profile.vehicles).toEqual(["Vélo", "Moto"]);
    expect(profile.referralCode).toMatch(/^ISS\d{5}$/);
  });

  it("génère un code de parrainage de huit caractères basé sur le nom du livreur", () => {
    expect(generateDriverReferralCode("Ali", 42)).toBe("ALI00042");
    expect(generateDriverReferralCode("É", 42)).toBe("É0000042");
  });
});
