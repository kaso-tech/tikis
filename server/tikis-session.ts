import { SignJWT, jwtVerify } from "jose";

const SESSION_ISSUER = "tikis-mobile";
const SESSION_AUDIENCE = "tikis-profile";
const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;
export const TIKIS_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function signingKey() {
  const value = process.env.TIKIS_SESSION_SECRET ?? process.env.JWT_SECRET;
  if (!value || value.length < 16) throw new Error("La signature de session Tikis est indisponible.");
  // Isole la signature Tikis de l’authentification interne tout en produisant
  // toujours une clé HMAC de 256 bits, y compris avec le secret plateforme court.
  return createHash("sha256").update(`tikis-profile-session:${value}`, "utf8").digest();
}

export async function createTikisProfileSession(phone: string) {
  if (!PHONE_PATTERN.test(phone)) throw new Error("Numéro de profil invalide.");
  return new SignJWT({ scope: "tikis:profile" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setSubject(phone)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(signingKey());
}

export async function verifyTikisProfileSession(token: string | undefined) {
  if (!token || token.length > 4096) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey(), { issuer: SESSION_ISSUER, audience: SESSION_AUDIENCE });
    if (payload.scope !== "tikis:profile" || typeof payload.sub !== "string" || !PHONE_PATTERN.test(payload.sub)) return null;
    return payload.sub;
  } catch {
    return null;
  }
}
import { createHash } from "node:crypto";
