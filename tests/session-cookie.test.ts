import { afterEach, describe, expect, it, vi } from "vitest";
import { getSessionCookieOptions } from "../server/_core/cookies";
import type { Request } from "express";

function fakeReq(overrides: Partial<{ hostname: string; secure: boolean }>): Request {
  return { hostname: "localhost", secure: false, ...overrides } as unknown as Request;
}

afterEach(() => vi.unstubAllEnvs());

describe("les options du cookie de session", () => {
  it("sont toujours same-site lax", () => {
    // `None` admettait le cookie sur une requête cross-site — une protection CSRF bien plus
    // faible que ce dont ce cookie, jamais destiné à sortir de tikisse.app, a jamais eu besoin.
    expect(getSessionCookieOptions(fakeReq({}))).toMatchObject({ sameSite: "lax" });
  });

  it("reflètent req.secure, que app.set(\"trust proxy\", 1) rend fiable derrière un reverse proxy", () => {
    expect(getSessionCookieOptions(fakeReq({ secure: true }))).toMatchObject({ secure: true });
    expect(getSessionCookieOptions(fakeReq({ secure: false }))).toMatchObject({ secure: false });
  });

  it("aucun domaine n'est posé pour localhost ou une IP : le cookie reste local à l'hôte exact", () => {
    expect(getSessionCookieOptions(fakeReq({ hostname: "localhost" })).domain).toBeUndefined();
    expect(getSessionCookieOptions(fakeReq({ hostname: "192.168.1.5" })).domain).toBeUndefined();
  });

  describe("le domaine du cookie", () => {
    it("TIKISSE_COOKIE_DOMAIN, quand il est configuré, prime sur l'en-tête Host de la requête", () => {
      // Dériver le domaine de la requête revient à laisser quiconque contrôle l'en-tête Host
      // choisir le domaine sur lequel le cookie de session s'applique — TIKISSE_COOKIE_DOMAIN
      // ferme ça en production en fixant la valeur une fois pour toutes.
      vi.stubEnv("TIKISSE_COOKIE_DOMAIN", ".tikisse.app");
      const options = getSessionCookieOptions(fakeReq({ hostname: "attacker-controlled.example" }));
      expect(options.domain).toBe(".tikisse.app");
    });

    it("sans TIKISSE_COOKIE_DOMAIN, aucun domaine : jamais déduit de l'en-tête Host, que le client choisit", () => {
      expect(getSessionCookieOptions(fakeReq({ hostname: "api.tikisse.app" })).domain).toBeUndefined();
      expect(getSessionCookieOptions(fakeReq({ hostname: "attacker-controlled.example" })).domain).toBeUndefined();
    });

    it("une valeur vide de TIKISSE_COOKIE_DOMAIN vaut absence", () => {
      vi.stubEnv("TIKISSE_COOKIE_DOMAIN", "");
      expect(getSessionCookieOptions(fakeReq({ hostname: "api.tikisse.app" })).domain).toBeUndefined();
    });
  });

  it("httpOnly et le chemin racine restent inconditionnels", () => {
    expect(getSessionCookieOptions(fakeReq({}))).toMatchObject({ httpOnly: true, path: "/" });
  });
});
