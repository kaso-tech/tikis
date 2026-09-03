import { describe, expect, it } from "vitest";
import { hashSessionToken, tokenLast4 } from "../server/_test-helpers/sessions-hash";

describe("hachage des tokens de session", () => {
  it("hashSessionToken produit un SHA-256 hex (64 chars)", () => {
    const hash = hashSessionToken("eyJhbGciOiJIUzI1NiJ9.payload.signature");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("hashSessionToken est déterministe (même input = même output)", () => {
    const a = hashSessionToken("token-abc");
    const b = hashSessionToken("token-abc");
    expect(a).toBe(b);
  });

  it("hashSessionToken change si l'input change (1 char)", () => {
    const a = hashSessionToken("token-abc");
    const b = hashSessionToken("token-abd");
    expect(a).not.toBe(b);
  });

  it("tokenLast4 retourne les 4 derniers caractères", () => {
    expect(tokenLast4("eyJhbGciOiJIUzI1NiJ9.payload.signature")).toBe("ture");
    expect(tokenLast4("abcd")).toBe("abcd");
  });
});
