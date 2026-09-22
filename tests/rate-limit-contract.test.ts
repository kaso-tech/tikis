import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const security = read("server/_core/security.ts");
const index = read("server/_core/index.ts");
const adminRouter = read("server/admin-router.ts");
const routers = read("server/routers.ts");

describe("l'IP du client vient de la connexion, pas d'un en-tête relu à la main", () => {
  it("le serveur pose trust proxy avant tout middleware", () => {
    // Sans lui, `req.ip` ignore X-Forwarded-For et retombe sur l'adresse du
    // proxy pour toutes les requêtes — le rate-limit général comme la limite
    // de connexion admin deviendraient alors inopérants, pas seulement
    // contournables.
    expect(index).toContain('app.set("trust proxy", 1)');
  });

  it("security.ts n'expose qu'une seule dérivation de l'IP, via req.ip", () => {
    expect(security).toContain("export function clientIp(");
    expect(security).toContain("req.ip ?? req.socket?.remoteAddress");
    // L'ancienne lecture manuelle de l'en-tête, qui l'acceptait même sans
    // `trust proxy`, ne doit plus exister nulle part dans ce fichier.
    expect(security).not.toMatch(/headers\[.x-forwarded-for.\]/);
  });

  it("admin-router.ts n'a plus sa propre copie de la même logique", () => {
    // Une seconde implémentation dupliquait le même bug pour la limite de
    // connexion admin : `assertLoginAllowed` n'était alors protégée par
    // rien qu'un client ne puisse réinitialiser à volonté.
    expect(adminRouter).toContain('import { clientIp } from "./_core/security"');
    expect(adminRouter).not.toMatch(/function clientIp/);
    expect(adminRouter).not.toMatch(/headers\[.x-forwarded-for.\]/);
  });

  it("le rate-limit public s'appuie sur la table partagée, pas sur une Map de processus", () => {
    expect(security).toContain("checkDistributedRateLimit(scope, key, windowMs, max)");
  });

  it("les limiteurs jamais branchés ont disparu plutôt que de rester comme fausse protection", () => {
    expect(security).not.toContain("export const authRateLimit");
    expect(security).not.toContain("export const registerRateLimit");
    expect(security).not.toContain("export const geographyRateLimit");
    expect(security).not.toContain("export function trpcRateLimit");
  });
});

describe("les mutations publiques d'authentification limitent aussi par IP", () => {
  const scopes = ["lookup", "lookupSupabase", "register", "registerSupabase", "update", "requestContactOtp", "updateContact"];

  it.each(scopes)("%s appelle enforcePerIpRateLimit avant enforcePerPhoneRateLimit", (scope) => {
    // Sans elle, un même client contourne la limite par numéro en essayant
    // des dizaines de numéros différents : chacun repart avec son propre
    // budget de 5 tentatives.
    const marker = `enforcePerPhoneRateLimit("${scope}"`;
    const index = routers.indexOf(marker);
    expect(index, `enforcePerPhoneRateLimit("${scope}", …) introuvable`).toBeGreaterThan(-1);
    const before = routers.slice(Math.max(0, index - 200), index);
    expect(before).toContain("await enforcePerIpRateLimit(ctx.req)");
  });

  it("un seul espace partagé pour tout le routeur profiles, pas un budget par mutation", () => {
    // Sinon, changer de mutation (lookup → register → requestContactOtp)
    // redonnerait un budget neuf à chaque bascule.
    expect(routers).toContain('const IP_AUTH_SCOPE = "profiles-auth"');
  });

  it("un contexte hors HTTP (IP inconnue) ne bloque jamais, il n'est simplement pas limité par ce biais", () => {
    expect(routers).toContain('if (ip === "unknown") return;');
  });
});
