/**
 * Double authentification de la console d'administration : codes TOTP à 6 chiffres (RFC 6238, HMAC-SHA1,
 * pas de 30 s), compatibles avec Google Authenticator, Microsoft Authenticator, 1Password, Aegis…
 *
 * Aucune dépendance externe pour le calcul : c'est une trentaine de lignes de crypto native, vérifiées
 * contre les vecteurs de test de la RFC (tests/admin-totp.test.ts).
 *
 * Le secret partagé n'est jamais stocké en clair : il est chiffré (AES-256-GCM) avec TIKISSE_ADMIN_TOTP_KEY,
 * une clé qui ne vit que dans l'environnement du serveur. Une copie de la base (sauvegarde, export) ne
 * suffit donc pas à générer des codes. Les codes de secours ne sont gardés qu'en empreinte SHA-256.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Tolérance d'un pas de chaque côté : un téléphone décalé de ±30 s fonctionne encore. */
export const TOTP_WINDOW = 1;
export const TOTP_ISSUER = "Tikisse Admin";
export const RECOVERY_CODE_COUNT = 10;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    // Jamais plus de 12 bits en attente : le masque évite le débordement des entiers 32 bits de JS.
    value = ((value << 8) | byte) & 0xfff;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Secret TOTP invalide.");
    value = ((value << 5) | index) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 160 bits, la taille recommandée par la RFC 4226 pour HMAC-SHA1. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(nowMs = Date.now()) {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

/** HOTP (RFC 4226) pour un pas donné. `digits` n'est paramétrable que pour les vecteurs de test de la RFC. */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function totpCode(secretBase32: string, nowMs = Date.now()) {
  return hotp(base32Decode(secretBase32), totpStep(nowMs));
}

/**
 * Pas auquel correspond `code`, ou `null`. Un pas déjà utilisé (`lastUsedStep`) ou antérieur est refusé :
 * un code intercepté ne peut pas être rejoué dans sa fenêtre de validité.
 */
export function matchTotpStep(secretBase32: string, code: string, options: { nowMs?: number; lastUsedStep?: number | null } = {}): number | null {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;
  const secret = base32Decode(secretBase32);
  const current = totpStep(options.nowMs);
  for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset += 1) {
    const step = current + offset;
    if (options.lastUsedStep != null && step <= options.lastUsedStep) continue;
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, Buffer.from(normalized))) return step;
  }
  return null;
}

export function otpauthUri(email: string, secretBase32: string) {
  const label = encodeURIComponent(`${TOTP_ISSUER}:${email}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer: TOTP_ISSUER, algorithm: "SHA1", digits: String(TOTP_DIGITS), period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** QR code en SVG, généré côté serveur : le secret ne transite par aucun service tiers de génération de QR. */
export async function otpauthQrSvg(uri: string) {
  return QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
}

// ————————————————————————————————————————————————————————————————————————
// Chiffrement du secret au repos
// ————————————————————————————————————————————————————————————————————————

function totpKey(): Buffer {
  const value = process.env.TIKISSE_ADMIN_TOTP_KEY ?? process.env.TIKIS_ADMIN_TOTP_KEY;
  if (!value || value.length < 32) {
    throw new Error("La double authentification n’est pas configurée sur ce serveur : définissez TIKISSE_ADMIN_TOTP_KEY (32 caractères ou plus, aléatoire, distinct des autres secrets).");
  }
  return createHash("sha256").update(value, "utf8").digest();
}

export function assertTotpConfigured() {
  totpKey();
}

export function encryptTotpSecret(secretBase32: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", totpKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secretBase32, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptTotpSecret(stored: string): string {
  const [version, iv, tag, data] = stored.split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Secret TOTP illisible.");
  const decipher = createDecipheriv("aes-256-gcm", totpKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

// ————————————————————————————————————————————————————————————————————————
// Codes de secours : usage unique, montrés une seule fois, gardés en empreinte
// ————————————————————————————————————————————————————————————————————————

export function normalizeRecoveryCode(code: string) {
  return code.replace(/[\s-]/g, "").toLowerCase();
}

export function hashRecoveryCode(code: string) {
  return createHash("sha256").update(normalizeRecoveryCode(code), "utf8").digest("hex");
}

/** 10 codes de 10 caractères base32 (50 bits chacun), présentés en deux groupes : « abcde-fghij ». */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  return Array.from({ length: count }, () => {
    const raw = base32Encode(randomBytes(7)).slice(0, 10).toLowerCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

/** Un code de secours se reconnaît à ses lettres ; un code TOTP n'a que des chiffres. */
export function looksLikeRecoveryCode(code: string) {
  return /[a-z]/i.test(code) && normalizeRecoveryCode(code).length === 10;
}
