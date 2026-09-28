/**
 * Module TOTP de la console admin, vérifié contre les vecteurs de test officiels (RFC 4226 annexe D,
 * RFC 6238 annexe B) : si ces codes ne correspondent pas, aucune application d'authentification ne
 * fonctionnerait avec la console.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  base32Decode, base32Encode, decryptTotpSecret, encryptTotpSecret, generateRecoveryCodes, generateTotpSecret,
  hashRecoveryCode, hotp, looksLikeRecoveryCode, matchTotpStep, otpauthUri, totpCode, totpStep,
} from "../server/admin-totp";

const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");
const env = process.env as Record<string, string | undefined>;
const savedKey = env.TIKIS_ADMIN_TOTP_KEY;
afterEach(() => { if (savedKey === undefined) delete env.TIKIS_ADMIN_TOTP_KEY; else env.TIKIS_ADMIN_TOTP_KEY = savedKey; });

describe("HOTP / TOTP — vecteurs des RFC", () => {
  it("RFC 4226 annexe D", () => {
    expect([0, 1, 2, 3, 9].map((counter) => hotp(RFC_SECRET, counter))).toEqual(["755224", "287082", "359152", "969429", "520489"]);
  });

  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ])("RFC 6238 annexe B, SHA-1, T=%i", (seconds, expected) => {
    expect(hotp(RFC_SECRET, totpStep(seconds * 1000), 8)).toBe(expected);
  });

  it("base32 aller-retour, et le secret RFC encodé comme dans les applications", () => {
    expect(base32Encode(RFC_SECRET)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ").equals(RFC_SECRET)).toBe(true);
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
  });
});

describe("vérification d'un code saisi", () => {
  const secret = base32Encode(RFC_SECRET);
  const now = 1_700_000_000_000;

  it("accepte le code courant et ceux à ±30 s, refuse au-delà", () => {
    const step = totpStep(now);
    expect(matchTotpStep(secret, totpCode(secret, now), { nowMs: now })).toBe(step);
    expect(matchTotpStep(secret, totpCode(secret, now - 30_000), { nowMs: now })).toBe(step - 1);
    expect(matchTotpStep(secret, totpCode(secret, now + 30_000), { nowMs: now })).toBe(step + 1);
    expect(matchTotpStep(secret, totpCode(secret, now - 90_000), { nowMs: now })).toBeNull();
  });

  it("refuse un code déjà utilisé : pas de rejeu dans la fenêtre de validité", () => {
    const code = totpCode(secret, now);
    const step = matchTotpStep(secret, code, { nowMs: now });
    expect(matchTotpStep(secret, code, { nowMs: now, lastUsedStep: step })).toBeNull();
  });

  it("refuse ce qui n'est pas un code à 6 chiffres", () => {
    expect(matchTotpStep(secret, "12345", { nowMs: now })).toBeNull();
    expect(matchTotpStep(secret, "abcdef", { nowMs: now })).toBeNull();
  });

  it("tolère les espaces que les applications affichent (« 123 456 »)", () => {
    const code = totpCode(secret, now);
    expect(matchTotpStep(secret, `${code.slice(0, 3)} ${code.slice(3)}`, { nowMs: now })).not.toBeNull();
  });
});

describe("secret chiffré au repos", () => {
  it("chiffre, déchiffre, et ne laisse jamais le secret lisible", () => {
    env.TIKIS_ADMIN_TOTP_KEY = "cle-de-test-totp-0123456789abcdef-0123";
    const secret = generateTotpSecret();
    const stored = encryptTotpSecret(secret);
    expect(stored).not.toContain(secret);
    expect(stored).not.toBe(encryptTotpSecret(secret)); // IV aléatoire
    expect(decryptTotpSecret(stored)).toBe(secret);
  });

  it("une autre clé ne déchiffre pas", () => {
    env.TIKIS_ADMIN_TOTP_KEY = "cle-de-test-totp-0123456789abcdef-0123";
    const stored = encryptTotpSecret(generateTotpSecret());
    env.TIKIS_ADMIN_TOTP_KEY = "une-autre-cle-totp-0123456789abcdef-99";
    expect(() => decryptTotpSecret(stored)).toThrow();
  });

  it("sans clé configurée, l'erreur dit quoi faire", () => {
    delete env.TIKIS_ADMIN_TOTP_KEY;
    expect(() => encryptTotpSecret("ABC")).toThrow(/TIKIS_ADMIN_TOTP_KEY/);
  });
});

describe("codes de secours et lien d'enrôlement", () => {
  it("10 codes distincts, au format abcde-fghij, reconnus comme codes de secours", () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
      expect(looksLikeRecoveryCode(code)).toBe(true);
    }
    expect(looksLikeRecoveryCode("123456")).toBe(false);
  });

  it("l'empreinte ignore la casse, les tirets et les espaces", () => {
    expect(hashRecoveryCode("ABCDE-FGHIJ")).toBe(hashRecoveryCode("abcde fghij"));
  });

  it("le lien otpauth porte l'émetteur, le compte et les paramètres standard", () => {
    const uri = otpauthUri("admin@tikis.app", "JBSWY3DPEHPK3PXP");
    expect(uri).toBe("otpauth://totp/Tikis%20Admin%3Aadmin%40tikis.app?secret=JBSWY3DPEHPK3PXP&issuer=Tikis+Admin&algorithm=SHA1&digits=6&period=30");
  });
});
