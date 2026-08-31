import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "components/tikis/auth-flow.tsx"), "utf8");

describe("erreurs de vérification du profil existant", () => {
  it("distingue les indisponibilités de profils, de session et de vérification Supabase", () => {
    expect(source).toContain("function profileLookupErrorMessage(error: unknown");
    expect(source).toContain("Le service des profils est temporairement indisponible.");
    expect(source).toContain("Votre session SMS a expiré ou ne correspond plus à ce numéro.");
    expect(source).toContain("Votre connexion sécurisée ne peut pas être créée pour le moment.");
  });

  it("préserve l’arrêt du flux au lieu de basculer vers l’inscription après une erreur de lookup", () => {
    expect(source).toContain("setOtpError(profileLookupErrorMessage(error, otpProvider));");
    expect(source).toContain("return;\n    }\n    const nextAttempts");
  });

  it("conserve une récupération sûre des liaisons Supabase obsolètes après validation du numéro", () => {
    const dbSource = readFileSync(join(process.cwd(), "server/db.ts"), "utf8");
    expect(dbSource).toContain("Links a profile only after the server has verified the matching Supabase phone session.");
    expect(dbSource).toContain("set({ supabaseUserId: null, updatedAt: new Date() })");
    expect(dbSource).toContain("set({ supabaseUserId, updatedAt: new Date() })");
  });
});
