import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { SignJWT, jwtVerify } from "jose";

const scrypt = promisify(scryptCallback);

const ADMIN_SESSION_ISSUER = "tikis-admin";
const ADMIN_SESSION_AUDIENCE = "tikis-admin-console";
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60; // 8h : une console d'admin garde une session courte, contrairement à l'app mobile.

/**
 * Authentification admin totalement séparée de celle des Senders/Livreurs (server/tikis-session.ts).
 * Aucune route de simulation ici : mot de passe hashé (scrypt, natif Node, aucune dépendance
 * supplémentaire à installer) + session JWT signée avec sa propre clé.
 */
function adminSigningKey() {
  const value = process.env.TIKIS_ADMIN_SESSION_SECRET;
  if (!value || value.length < 24) throw new Error("La signature de session admin est indisponible : configurez TIKIS_ADMIN_SESSION_SECRET (24+ caractères, distinct des autres secrets).");
  return new TextEncoder().encode(value);
}

export async function hashAdminPassword(password: string): Promise<string> {
  if (password.length < 12) throw new Error("Le mot de passe admin doit contenir au moins 12 caractères.");
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyAdminPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const derived = (await scrypt(password, salt, expected.length)) as Buffer;
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export type AdminRole = "super_admin" | "support" | "finance";

export async function createAdminSession(adminId: number, email: string, role: AdminRole) {
  return new SignJWT({ scope: "tikis:admin", email, role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ADMIN_SESSION_ISSUER)
    .setAudience(ADMIN_SESSION_AUDIENCE)
    .setSubject(String(adminId))
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_SESSION_TTL_SECONDS}s`)
    .sign(adminSigningKey());
}

export async function verifyAdminSession(token: string | undefined) {
  if (!token || token.length > 4096) return null;
  try {
    const { payload } = await jwtVerify(token, adminSigningKey(), { issuer: ADMIN_SESSION_ISSUER, audience: ADMIN_SESSION_AUDIENCE });
    if (payload.scope !== "tikis:admin" || typeof payload.sub !== "string" || typeof payload.email !== "string" || typeof payload.role !== "string") return null;
    const adminId = Number(payload.sub);
    if (!Number.isInteger(adminId)) return null;
    return { adminId, email: payload.email, role: payload.role as AdminRole };
  } catch {
    return null;
  }
}

/** Limiteur de tentatives en mémoire (par processus). Suffisant pour une première protection ;
 *  à remplacer par un stockage partagé (Redis) si l'admin tourne sur plusieurs instances. */
const loginAttempts = new Map<string, { count: number; blockedUntil?: number }>();
const MAX_ATTEMPTS = 5;
const BLOCK_DURATION_MS = 15 * 60_000;

export function assertLoginAllowed(key: string) {
  const entry = loginAttempts.get(key);
  if (entry?.blockedUntil && entry.blockedUntil > Date.now()) {
    throw new Error("Trop de tentatives de connexion. Réessayez dans quelques minutes.");
  }
}

export function recordLoginFailure(key: string) {
  const entry = loginAttempts.get(key) ?? { count: 0 };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.blockedUntil = Date.now() + BLOCK_DURATION_MS;
    entry.count = 0;
  }
  loginAttempts.set(key, entry);
}

export function recordLoginSuccess(key: string) {
  loginAttempts.delete(key);
}
