import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { yengapayNotConfiguredError, yengapayProviderError } from "../server/yengapay";

afterEach(() => vi.restoreAllMocks());

describe("une erreur de YengaPay ne remonte jamais brute jusqu'à l'écran", () => {
  it("transmet le message court d'une erreur côté client, utile à l'utilisateur", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = yengapayProviderError("paiement direct /pay", 400, JSON.stringify({ message: "Code OTP invalide ou expiré", details: { projectId: "prj_interne" } }));
    expect(error.message).toBe("Paiement refusé par l'opérateur : Code OTP invalide ou expiré");
    expect(error.message).not.toContain("prj_interne");
  });

  it("n'expose rien d'une panne du prestataire, mais la garde dans les journaux du serveur", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const body = JSON.stringify({ message: "upstream timeout", trace: "at org_7f3a/project_91 …" });
    const error = yengapayProviderError("YengaPay /payment-intent", 502, body);
    expect(error.message).toBe("Le paiement Mobile Money est momentanément indisponible. Réessayez dans quelques instants.");
    expect(error.message).not.toContain("org_7f3a");
    expect(JSON.stringify(log.mock.calls)).toContain("org_7f3a");
  });

  it("n'extrait rien d'un corps qui n'est pas du JSON", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(yengapayProviderError("x", 400, "<html>Bad Gateway</html>").message).not.toContain("html");
  });

  it("tronque un message de prestataire démesuré", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = yengapayProviderError("x", 422, JSON.stringify({ message: "a".repeat(5000) }));
    expect(error.message.length).toBeLessThan(220);
  });

  it("ne cite pas les variables d'environnement quand la configuration est incomplète", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(yengapayNotConfiguredError().message).not.toMatch(/YENGAPAY_/);
  });

  it("plus aucun client HTTP de YengaPay n'enrobe le corps de la réponse dans son erreur", () => {
    for (const file of ["server/yengapay.ts", "server/yengapay-direct.ts"]) {
      expect(readFileSync(join(process.cwd(), file), "utf8")).not.toContain("text.slice(0, 1200)");
    }
  });
});

describe("le paiement Mobile Money est limité par profil", () => {
  const routers = readFileSync(join(process.cwd(), "server/routers.ts"), "utf8");
  const procedure = (name: string) => routers.slice(routers.indexOf(`    ${name}: tikisProtectedProcedure`), routers.indexOf("}),", routers.indexOf(`    ${name}: tikisProtectedProcedure`)));

  it.each([
    ["requestDirectDeposit", "request"],
    ["resendDirectDepositOtp", "resendOtp"],
    ["payDirectDeposit", "submitOtp"],
    ["initiateYengaPay", "checkout"],
    ["initiateYengaPayTest", "checkout"],
  ])("%s passe par sa limite avant d'appeler YengaPay", (name, action) => {
    const body = procedure(name);
    expect(body).toContain(`await enforcePaymentRateLimit("${action}", profile.phone);`);
    // La limite passe avant tout appel au prestataire.
    const limitAt = body.indexOf("enforcePaymentRateLimit");
    const callAt = Math.max(body.indexOf("await import(\"./yengapay-direct\")"), body.indexOf("db.initiateYengaPay"));
    expect(limitAt).toBeLessThan(callAt);
  });
});
