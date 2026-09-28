import { SignJWT, jwtVerify } from "jose";

const SESSION_ISSUER = "tikisse-mobile";
const SESSION_AUDIENCE = "tikisse-profile";
const SESSION_SCOPE = "tikisse:profile";
// Renommage Tikis → Tikisse : les jetons déjà émis (durée de vie d'un an, cf. plus bas) portent l'ancien
// issuer/audience/scope et sont signés avec l'ancienne clé dérivée. On continue de les accepter en lecture
// (verifyTikisseProfileSessionClaims essaie la nouvelle clé, puis l'ancienne) pour ne pas déconnecter tous
// les utilisateurs déjà connectés au déploiement ; seule l'émission de nouveaux jetons utilise le nouveau
// nom. Ce chemin de compatibilité pourra être retiré un an après le déploiement de ce renommage (durée de
// vie maximale d'un jeton), une fois qu'aucun jeton "tikis:*" ne peut plus être en circulation.
const LEGACY_SESSION_ISSUER = "tikis-mobile";
const LEGACY_SESSION_AUDIENCE = "tikis-profile";
const LEGACY_SESSION_SCOPE = "tikis:profile";
const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;
/**
 * Un an, et non trente jours : on ne redemande pas son numéro à quelqu'un parce qu'il n'a pas
 * ouvert l'application depuis un mois. La contrepartie habituelle d'un jeton longue durée — ne
 * plus pouvoir le rappeler — ne s'applique pas ici : `isSessionRevoked` (server/sessions.ts) est
 * vérifié à chaque requête, donc une déconnexion depuis un autre appareil coupe l'accès
 * immédiatement, quelle que soit l'échéance inscrite dans le jeton.
 */
export const TIKISSE_SESSION_TTL_SECONDS = 365 * 24 * 60 * 60;

/** Secret brut : nouveau nom de variable d'environnement, avec repli sur l'ancien nom (pas encore
 *  renommé dans le déploiement) puis sur le secret générique de la plateforme. */
function rawSecret() {
  const value = process.env.TIKISSE_SESSION_SECRET ?? process.env.TIKIS_SESSION_SECRET ?? process.env.JWT_SECRET;
  if (!value || value.length < 16) throw new Error("La signature de session Tikisse est indisponible.");
  return value;
}

function signingKey() {
  // Isole la signature Tikisse de l’authentification interne tout en produisant
  // toujours une clé HMAC de 256 bits, y compris avec le secret plateforme court.
  return createHash("sha256").update(`tikisse-profile-session:${rawSecret()}`, "utf8").digest();
}

/** Même secret, ancienne chaîne de dérivation : reproduit exactement la clé qui a signé les jetons émis
 *  avant le renommage, pour continuer à les vérifier. */
function legacySigningKey() {
  return createHash("sha256").update(`tikis-profile-session:${rawSecret()}`, "utf8").digest();
}

export async function createTikisseProfileSession(phone: string) {
  if (!PHONE_PATTERN.test(phone)) throw new Error("Numéro de profil invalide.");
  return new SignJWT({ scope: SESSION_SCOPE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setSubject(phone)
    .setIssuedAt()
    .setExpirationTime(`${TIKISSE_SESSION_TTL_SECONDS}s`)
    .sign(signingKey());
}

export async function verifyTikisseProfileSession(token: string | undefined) {
  return (await verifyTikisseProfileSessionClaims(token))?.phone ?? null;
}

/** Numéro et date d'émission (secondes) d'un jeton valide ; `null` sinon. Accepte un jeton signé avant le
 *  renommage Tikis → Tikisse (voir les constantes LEGACY_* plus haut). */
export async function verifyTikisseProfileSessionClaims(token: string | undefined) {
  if (!token || token.length > 4096) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey(), { issuer: SESSION_ISSUER, audience: SESSION_AUDIENCE });
    if (payload.scope !== SESSION_SCOPE || typeof payload.sub !== "string" || !PHONE_PATTERN.test(payload.sub)) return null;
    return { phone: payload.sub, issuedAt: typeof payload.iat === "number" ? payload.iat : 0 };
  } catch {
    // Pas forcément un jeton invalide : peut-être un jeton pré-renommage, signé et étiqueté différemment.
  }
  try {
    const { payload } = await jwtVerify(token, legacySigningKey(), { issuer: LEGACY_SESSION_ISSUER, audience: LEGACY_SESSION_AUDIENCE });
    if (payload.scope !== LEGACY_SESSION_SCOPE || typeof payload.sub !== "string" || !PHONE_PATTERN.test(payload.sub)) return null;
    return { phone: payload.sub, issuedAt: typeof payload.iat === "number" ? payload.iat : 0 };
  } catch {
    return null;
  }
}

/**
 * Déconnexion forcée : tout jeton émis avant `sessionsRevokedAt` (seconde de la décision) est refusé,
 * qu'il ait été enregistré comme appareil ou non, natif ou web. Les jetons émis dans la même seconde
 * que la décision restent valides : la reconnexion immédiate n'est jamais refusée.
 */
export function isRevokedByProfile(issuedAt: number, sessionsRevokedAt: Date | null | undefined) {
  if (!sessionsRevokedAt) return false;
  return issuedAt < Math.floor(sessionsRevokedAt.getTime() / 1000);
}
import { createHash } from "node:crypto";
