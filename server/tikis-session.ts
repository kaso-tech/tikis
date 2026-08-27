import { SignJWT, jwtVerify } from "jose";

const SESSION_ISSUER = "tikis-mobile";
const SESSION_AUDIENCE = "tikis-profile";
const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

function signingKey() {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) throw new Error("La signature de session Tikis est indisponible.");
  return new TextEncoder().encode(value);
}

export async function createTikisProfileSession(phone: string) {
  if (!PHONE_PATTERN.test(phone)) throw new Error("Numéro de profil invalide.");
  return new SignJWT({ scope: "tikis:profile" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setSubject(phone)
    .setIssuedAt()
    .setExpirationTime("7d")
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
