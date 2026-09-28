import { SignJWT, decodeJwt } from "jose";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTikisseProfileSession, TIKISSE_SESSION_TTL_SECONDS, verifyTikisseProfileSession } from "../server/tikisse-session";

const previousJwtSecret = process.env.JWT_SECRET;

beforeEach(() => {
  process.env.JWT_SECRET = "x".repeat(48);
});

afterEach(() => {
  if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousJwtSecret;
});

describe("session Tikisse signée", () => {
  it("signe une session de profil et en vérifie l’identité", async () => {
    const token = await createTikisseProfileSession("+22670000000");
    await expect(verifyTikisseProfileSession(token)).resolves.toBe("+22670000000");
  });

  it("conserve une session de profil valide pendant un an", async () => {
    const payload = decodeJwt(await createTikisseProfileSession("+22670000001"));
    expect(payload.exp).toBeTypeOf("number");
    expect(payload.iat).toBeTypeOf("number");
    // L'échéance inscrite dans le jeton suit la constante, au lieu d'une durée écrite à part qui
    // pouvait diverger d'elle sans que rien ne le signale.
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(TIKISSE_SESSION_TTL_SECONDS);
    // Et la constante elle-même vaut bien un an : personne ne doit ressaisir son numéro parce
    // qu'il n'a pas ouvert l'application depuis un mois.
    expect(TIKISSE_SESSION_TTL_SECONDS).toBe(365 * 24 * 60 * 60);
  });

  it("rejette un jeton non signé ou une identité invalide", async () => {
    await expect(verifyTikisseProfileSession("not-a-valid-session")).resolves.toBeNull();
    await expect(createTikisseProfileSession("70000000")).rejects.toThrow("invalide");
  });

  it("dérive une clé HMAC stable lorsque le secret plateforme est plus court que 32 caractères", async () => {
    process.env.JWT_SECRET = "secret-plateforme-court";
    const token = await createTikisseProfileSession("+22676000000");
    await expect(verifyTikisseProfileSession(token)).resolves.toBe("+22676000000");
  });

  it("accepte encore un jeton émis avant le renommage Tikis → Tikisse, avec le même secret", async () => {
    // Reproduit exactement ce que signait l'ancien server/tikis-session.ts, avant renommage : même dérivation
    // de clé (préfixe "tikis-profile-session:"), ancien issuer/audience/scope. Un utilisateur déjà connecté
    // au moment du déploiement ne doit pas être déconnecté.
    const legacyKey = createHash("sha256").update(`tikis-profile-session:${process.env.JWT_SECRET}`, "utf8").digest();
    const legacyToken = await new SignJWT({ scope: "tikis:profile" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("tikis-mobile")
      .setAudience("tikis-profile")
      .setSubject("+22670000002")
      .setIssuedAt()
      .setExpirationTime(`${TIKISSE_SESSION_TTL_SECONDS}s`)
      .sign(legacyKey);
    await expect(verifyTikisseProfileSession(legacyToken)).resolves.toBe("+22670000002");
  });

  it("un jeton pré-renommage signé avec un secret différent (dérive fausse) reste rejeté", async () => {
    const wrongKey = createHash("sha256").update("tikis-profile-session:un-autre-secret-quelconque", "utf8").digest();
    const forged = await new SignJWT({ scope: "tikis:profile" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("tikis-mobile")
      .setAudience("tikis-profile")
      .setSubject("+22670000003")
      .setIssuedAt()
      .setExpirationTime(`${TIKISSE_SESSION_TTL_SECONDS}s`)
      .sign(wrongKey);
    await expect(verifyTikisseProfileSession(forged)).resolves.toBeNull();
  });
});
