import { describe, expect, it } from "vitest";
import { clientIp } from "../server/_core/security";

describe("clientIp", () => {
  it("retient req.ip, que trust proxy a résolu correctement", () => {
    expect(clientIp({ ip: "41.202.11.5" })).toBe("41.202.11.5");
  });

  it("retombe sur l'adresse de la connexion quand req.ip est absent", () => {
    expect(clientIp({ socket: { remoteAddress: "10.0.0.7" } })).toBe("10.0.0.7");
  });

  it("ne lit jamais l'en-tête X-Forwarded-For elle-même", () => {
    // C'était le bug : une lecture manuelle de l'en-tête l'acceptait même sans
    // `trust proxy`, donc même quand rien de confiance ne l'avait posé. Un
    // objet qui porte l'en-tête mais pas `.ip` (celui qu'Express calcule une
    // fois `trust proxy` posé) ne doit rendre qu'une IP inconnue.
    const fakeRequest = { headers: { "x-forwarded-for": "1.2.3.4" } } as unknown as { ip?: string; socket?: { remoteAddress?: string } };
    expect(clientIp(fakeRequest)).toBe("unknown");
  });

  it("rend « unknown » sans req.ip ni connexion identifiable", () => {
    expect(clientIp({})).toBe("unknown");
  });
});
