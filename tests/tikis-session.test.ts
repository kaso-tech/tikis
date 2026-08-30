import { decodeJwt } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTikisProfileSession, TIKIS_SESSION_TTL_SECONDS, verifyTikisProfileSession } from "../server/tikis-session";

const previousJwtSecret = process.env.JWT_SECRET;

beforeEach(() => {
  process.env.JWT_SECRET = "x".repeat(48);
});

afterEach(() => {
  if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousJwtSecret;
});

describe("session Tikis signée", () => {
  it("signe une session de profil et en vérifie l’identité", async () => {
    const token = await createTikisProfileSession("+22670000000");
    await expect(verifyTikisProfileSession(token)).resolves.toBe("+22670000000");
  });

  it("conserve une session de profil valide pendant trente jours", async () => {
    const payload = decodeJwt(await createTikisProfileSession("+22670000001"));
    expect(payload.exp).toBeTypeOf("number");
    expect(payload.iat).toBeTypeOf("number");
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(TIKIS_SESSION_TTL_SECONDS);
  });

  it("rejette un jeton non signé ou une identité invalide", async () => {
    await expect(verifyTikisProfileSession("not-a-valid-session")).resolves.toBeNull();
    await expect(createTikisProfileSession("70000000")).rejects.toThrow("invalide");
  });

  it("dérive une clé HMAC stable lorsque le secret plateforme est plus court que 32 caractères", async () => {
    process.env.JWT_SECRET = "secret-plateforme-court";
    const token = await createTikisProfileSession("+22676000000");
    await expect(verifyTikisProfileSession(token)).resolves.toBe("+22676000000");
  });
});
