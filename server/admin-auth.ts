import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60; // 8h : une console d'admin garde une session courte, contrairement à l'app mobile.
export const ADMIN_SESSION_COOKIE = "tikisse_admin_session";
// Renommage Tikis → Tikisse : nom du cookie avant le renommage, relu en secours (server/_core/context.ts)
// pour qu'un admin déjà connecté n'ait pas à se reconnecter au déploiement.
export const LEGACY_ADMIN_SESSION_COOKIE = "tikis_admin_session";
/**
 * En-tête que la console envoie avec chaque requête. Le cookie seul ne suffit pas à authentifier : un site
 * tiers peut faire envoyer un cookie par le navigateur, pas ajouter un en-tête personnalisé sans une
 * pré-vérification CORS que seules les origines autorisées passent (défense CSRF en plus de SameSite).
 */
export const ADMIN_CONSOLE_HEADER = "x-tikisse-admin";

/**
 * Authentification admin totalement séparée de celle des Senders/Livreurs (server/tikisse-session.ts).
 * Aucune route de simulation ici : mot de passe hashé (scrypt, natif Node, aucune dépendance
 * supplémentaire à installer) + session opaque stockée en base (server/admin-db.ts, tikisse_admin_sessions).
 */

/** Jeton de session : 256 bits aléatoires. Seul le navigateur le détient ; la base garde son empreinte. */
export function newAdminSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashAdminSessionToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
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

export type { AdminRole } from "../shared/admin-roles";

// Empreinte d'un mot de passe que personne ne connaît, calculée une fois. Quand l'email est inconnu, on
// vérifie quand même le mot de passe contre elle : sans ça, la réponse arrivait sans calcul scrypt,
// nettement plus vite, et le temps de réponse révélait quels emails ont un compte admin.
let decoyHash: Promise<string> | null = null;

export async function verifyAdminPasswordOrDecoy(password: string, storedHash: string | null | undefined): Promise<boolean> {
  if (storedHash) return verifyAdminPassword(password, storedHash);
  decoyHash ??= hashAdminPassword(randomBytes(24).toString("hex"));
  await verifyAdminPassword(password, await decoyHash);
  return false;
}
