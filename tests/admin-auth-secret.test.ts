import { describe, expect, it } from "vitest";
import { hashAdminSessionToken, newAdminSessionToken, verifyAdminPasswordOrDecoy } from "../server/admin-auth";

describe("jeton de session administrateur", () => {
  it("est aléatoire, long, et seule son empreinte est comparable", () => {
    const first = newAdminSessionToken();
    const second = newAdminSessionToken();
    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(43); // 32 octets en base64url
    expect(hashAdminSessionToken(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAdminSessionToken(first)).toBe(hashAdminSessionToken(first));
    expect(hashAdminSessionToken(first)).not.toBe(first);
  });

  it("un email inconnu coûte le même calcul qu'un vrai compte, et échoue toujours", async () => {
    await expect(verifyAdminPasswordOrDecoy("n'importe quoi", undefined)).resolves.toBe(false);
  });

  const checkBootstrapPassword = process.env.TIKISSE_ADMIN_BOOTSTRAP_PASSWORD ? it : it.skip;

  checkBootstrapPassword("valide le mot de passe de bootstrap sans le révéler", async () => {
    const { hashAdminPassword, verifyAdminPassword } = await import("../server/admin-auth");
    const password = process.env.TIKISSE_ADMIN_BOOTSTRAP_PASSWORD ?? "";

    expect(password.length).toBeGreaterThanOrEqual(12);
    const hash = await hashAdminPassword(password);
    await expect(verifyAdminPassword(password, hash)).resolves.toBe(true);
  });
});
