import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTikisProfileSession, verifyTikisProfileSession } from "../server/tikis-session";

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

  it("rejette un jeton non signé ou une identité invalide", async () => {
    await expect(verifyTikisProfileSession("not-a-valid-session")).resolves.toBeNull();
    await expect(createTikisProfileSession("70000000")).rejects.toThrow("invalide");
  });
});
