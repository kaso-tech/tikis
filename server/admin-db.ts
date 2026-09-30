import { randomUUID } from "crypto";
import { and, count, desc, eq, gte, ilike, inArray, isNull, like, lt, lte, ne, or, sql } from "drizzle-orm";
import { countryDraftIssue, countryPlanWarning } from "../shared/iso-countries";
import { ADMIN_SESSION_TTL_SECONDS, hashAdminSessionToken, newAdminSessionToken, type AdminRole } from "./admin-auth";
import {
  decryptTotpSecret, encryptTotpSecret, generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, looksLikeRecoveryCode,
  matchTotpStep, otpauthQrSvg, otpauthUri,
} from "./admin-totp";
import { getDb } from "./db";
import * as db from "./db";
import {
  tikisseAdminAuditLog,
  tikisseAdminSessions,
  tikisseAdminUsers,
  tikisseDeliveries,
  tikisseDeliveryCandidates,
  tikisseDeliveryEvents,
  tikisseDeliveryLiveLocations,
  tikisseDeliveryReports,
  tikisseKycSubmissions,
  tikisseLoyaltyGrants,
  tikisseLoyaltyPrograms,
  tikissePaymentTransactions,
  tikissePlatformSettings,
  tikisseProfiles,
  tikisseRateLimits,
  tikisseReferrals,
  tikisseSupportedCountries,
  tikisseWalletLedger,
  tikisseWallets,
  type TikisseAdminUser,
  type TikisseDelivery,
} from "../drizzle/schema";

// ————————————————————————————————————————————————————————————————————————
// Comptes admin
// ————————————————————————————————————————————————————————————————————————

export async function getAdminByEmail(email: string): Promise<TikisseAdminUser | undefined> {
  const db = await getDb();
  if (!db) throw new Error("La console d’administration est temporairement indisponible.");
  const rows = await db.select().from(tikisseAdminUsers).where(eq(tikisseAdminUsers.email, email.trim().toLowerCase())).limit(1);
  return rows[0];
}

export async function touchAdminLastLogin(adminId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(tikisseAdminUsers).set({ lastLoginAt: new Date() }).where(eq(tikisseAdminUsers.id, adminId));
}

/** Réservé au bootstrap (script one-off ou premier compte) — jamais exposé sur une route publique. */
export async function createAdminUser(input: { email: string; passwordHash: string; fullName: string; role: AdminRole; mustChangePassword?: boolean }) {
  const db = await getDb();
  if (!db) throw new Error("La console d’administration est temporairement indisponible.");
  await db.insert(tikisseAdminUsers).values({ email: input.email.trim().toLowerCase(), passwordHash: input.passwordHash, fullName: input.fullName, role: input.role, mustChangePassword: input.mustChangePassword ?? false });
  return getAdminByEmail(input.email);
}

export async function listAdminUsers() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ id: tikisseAdminUsers.id, email: tikisseAdminUsers.email, fullName: tikisseAdminUsers.fullName, role: tikisseAdminUsers.role, active: tikisseAdminUsers.active, lastLoginAt: tikisseAdminUsers.lastLoginAt, createdAt: tikisseAdminUsers.createdAt, totpEnabledAt: tikisseAdminUsers.totpEnabledAt, mustChangePassword: tikisseAdminUsers.mustChangePassword }).from(tikisseAdminUsers).orderBy(desc(tikisseAdminUsers.createdAt));
  return rows.map(({ totpEnabledAt, ...row }) => ({ ...row, totpEnabled: Boolean(totpEnabledAt) }));
}

/**
 * Suspendre ou réactiver un compte admin. Deux verrous empêchent de perdre la main sur la console :
 * personne ne se suspend soi-même, et le dernier super-admin actif ne peut pas être suspendu — sans
 * lui, plus personne ne pourrait réactiver un compte ni gérer l'équipe autrement qu'en base.
 */
export async function setAdminUserActive(input: { actorAdminId: number; adminId: number; active: boolean }) {
  const db = await getDb();
  if (!db) throw new Error("La console d’administration est temporairement indisponible.");
  await db.transaction(async (tx) => {
    const target = (await tx.select().from(tikisseAdminUsers).where(eq(tikisseAdminUsers.id, input.adminId)).limit(1).for("update"))[0];
    if (!target) throw new Error("Compte admin introuvable.");
    if (!input.active) {
      if (input.actorAdminId === input.adminId) throw new Error("Vous ne pouvez pas suspendre votre propre compte vous-même.");
      if (target.role === "super_admin" && target.active) {
        const others = await tx.select({ id: tikisseAdminUsers.id }).from(tikisseAdminUsers).where(and(eq(tikisseAdminUsers.role, "super_admin"), eq(tikisseAdminUsers.active, true))).for("update");
        if (others.filter((row) => row.id !== target.id).length === 0) throw new Error("Impossible de suspendre le dernier super-admin actif.");
      }
    }
    await tx.update(tikisseAdminUsers).set({ active: input.active }).where(eq(tikisseAdminUsers.id, input.adminId));
    // Le compte inactif suffit déjà à refuser ses sessions ; les révoquer en plus garantit qu'une
    // réactivation ultérieure ne ressuscite pas une session ouverte avant la suspension.
    if (!input.active) await revokeAllAdminSessions(input.adminId, tx);
  });
}

/** Délai pour saisir le code de double authentification après le mot de passe. */
export const PENDING_TOTP_TTL_MS = 5 * 60_000;

/**
 * Ouvre une session : le jeton part dans le cookie, la base n'en garde que l'empreinte. Une session
 * `pending_totp` ne donne accès à rien (voir `authenticateAdminSession`) et expire en 5 minutes.
 */
export async function createAdminSession(input: { adminId: number; ipAddress?: string; userAgent?: string; stage?: "pending_totp" | "active" }, tx?: any) {
  const db = tx ?? await getDb();
  if (!db) throw new Error("La console d’administration est temporairement indisponible.");
  const token = newAdminSessionToken();
  const stage = input.stage ?? "active";
  const expiresAt = new Date(Date.now() + (stage === "pending_totp" ? PENDING_TOTP_TTL_MS : ADMIN_SESSION_TTL_SECONDS * 1000));
  await db.insert(tikisseAdminSessions).values({
    id: randomUUID(), adminId: input.adminId, tokenHash: hashAdminSessionToken(token),
    ipAddress: input.ipAddress?.slice(0, 64) ?? null, userAgent: input.userAgent?.slice(0, 255) ?? null, expiresAt, stage,
  });
  return { token, expiresAt };
}

const LAST_SEEN_REFRESH_MS = 5 * 60_000;

/**
 * Identité admin effective d'une requête. La session doit exister, ne pas être révoquée ni expirée, et le
 * compte doit être actif ; le rôle appliqué est celui du compte à cet instant. Sans base, aucune session
 * n'est acceptée — rien n'y fonctionnerait de toute façon.
 */
export type AdminIdentity = { adminId: number; email: string; role: AdminRole; totpEnabled: boolean; mustEnrollTotp: boolean; mustChangePassword: boolean; sessionId: string };

export async function authenticateAdminSession(token: string | undefined): Promise<AdminIdentity | null> {
  if (!token || token.length > 200) return null;
  const db = await getDb();
  if (!db) return null;
  const row = (await db.select({
    sessionId: tikisseAdminSessions.id, expiresAt: tikisseAdminSessions.expiresAt, revokedAt: tikisseAdminSessions.revokedAt, lastSeenAt: tikisseAdminSessions.lastSeenAt, stage: tikisseAdminSessions.stage,
    id: tikisseAdminUsers.id, email: tikisseAdminUsers.email, role: tikisseAdminUsers.role, active: tikisseAdminUsers.active, totpEnabledAt: tikisseAdminUsers.totpEnabledAt, mustChangePassword: tikisseAdminUsers.mustChangePassword,
  }).from(tikisseAdminSessions).innerJoin(tikisseAdminUsers, eq(tikisseAdminSessions.adminId, tikisseAdminUsers.id))
    .where(eq(tikisseAdminSessions.tokenHash, hashAdminSessionToken(token))).limit(1))[0];
  // Une session en attente du code de double authentification n'ouvre rien : mot de passe seul ≠ connexion.
  if (!row || row.stage !== "active" || row.revokedAt || row.expiresAt.getTime() <= Date.now() || !row.active) return null;
  if (Date.now() - row.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS) {
    void db.update(tikisseAdminSessions).set({ lastSeenAt: new Date() }).where(eq(tikisseAdminSessions.id, row.sessionId)).catch(() => {});
  }
  const totpEnabled = Boolean(row.totpEnabledAt);
  // Compte soumis à l'obligation mais pas encore enrôlé : il n'accède qu'à son propre enrôlement (trpc.ts).
  const mustEnrollTotp = !totpEnabled && isTotpRequiredRole(row.role) && await isAdminTotpRequired(db);
  return { adminId: row.id, email: row.email, role: row.role, totpEnabled, mustEnrollTotp, mustChangePassword: row.mustChangePassword, sessionId: row.sessionId };
}

/** Déconnexion : la session ne vaut plus rien, même si quelqu'un a copié le cookie. */
export async function revokeAdminSession(token: string | undefined) {
  if (!token) return;
  const db = await getDb();
  if (!db) return;
  await db.update(tikisseAdminSessions).set({ revokedAt: new Date() }).where(and(eq(tikisseAdminSessions.tokenHash, hashAdminSessionToken(token)), isNull(tikisseAdminSessions.revokedAt)));
}

export async function revokeAllAdminSessions(adminId: number, tx?: any) {
  const handle = tx ?? await getDb();
  if (!handle) return;
  await handle.update(tikisseAdminSessions).set({ revokedAt: new Date() }).where(and(eq(tikisseAdminSessions.adminId, adminId), isNull(tikisseAdminSessions.revokedAt)));
}

// ————————————————————————————————————————————————————————————————————————
// Double authentification (TOTP)
// ————————————————————————————————————————————————————————————————————————

/** Rôles soumis à l'obligation quand elle est activée : ceux qui touchent à l'argent et aux accès. */
export const TOTP_REQUIRED_ROLES: readonly AdminRole[] = ["super_admin", "finance"];
export const isTotpRequiredRole = (role: AdminRole) => TOTP_REQUIRED_ROLES.includes(role);

export async function isAdminTotpRequired(handle?: any): Promise<boolean> {
  const db = handle ?? await getDb();
  if (!db) return false;
  const row = (await db.select({ required: tikissePlatformSettings.adminTotpRequired }).from(tikissePlatformSettings).where(eq(tikissePlatformSettings.id, 1)).limit(1))[0];
  return Boolean(row?.required);
}

function parseRecoveryHashes(stored: string | null): string[] {
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Vérifie un second facteur — code TOTP ou code de secours — et le consomme, sous verrou du compte : deux
 * requêtes simultanées avec le même code ne passent jamais toutes les deux.
 */
export async function consumeSecondFactor(tx: any, adminId: number, code: string): Promise<{ method: "totp" | "recovery_code"; remainingRecoveryCodes: number } | null> {
  const account = (await tx.select().from(tikisseAdminUsers).where(eq(tikisseAdminUsers.id, adminId)).limit(1).for("update"))[0];
  if (!account?.totpSecret || !account.totpEnabledAt) return null;
  const hashes = parseRecoveryHashes(account.totpRecoveryCodes);
  if (looksLikeRecoveryCode(code)) {
    const hash = hashRecoveryCode(code);
    if (!hashes.includes(hash)) return null;
    const remaining = hashes.filter((value) => value !== hash);
    await tx.update(tikisseAdminUsers).set({ totpRecoveryCodes: JSON.stringify(remaining) }).where(eq(tikisseAdminUsers.id, adminId));
    return { method: "recovery_code", remainingRecoveryCodes: remaining.length };
  }
  const step = matchTotpStep(decryptTotpSecret(account.totpSecret), code, { lastUsedStep: account.totpLastUsedStep });
  if (step === null) return null;
  await tx.update(tikisseAdminUsers).set({ totpLastUsedStep: step }).where(eq(tikisseAdminUsers.id, adminId));
  return { method: "totp", remainingRecoveryCodes: hashes.length };
}

export const TOTP_ATTEMPT_LIMIT = 5;

/**
 * Seconde étape de connexion. La session « en attente » est révoquée et remplacée par une session neuve :
 * le jeton émis avant le second facteur ne devient jamais, à lui seul, une session complète.
 * 5 codes faux en 15 minutes sur un compte révoquent la tentative : il faut repasser par le mot de passe.
 */
export async function completeTotpLogin(input: { token: string | undefined; code: string; ipAddress?: string; userAgent?: string }) {
  const db = await getDb();
  if (!db) throw new Error("La console d’administration est temporairement indisponible.");
  if (!input.token) throw new Error("Session de connexion expirée. Reconnectez-vous.");
  const pending = (await db.select({ sessionId: tikisseAdminSessions.id, stage: tikisseAdminSessions.stage, expiresAt: tikisseAdminSessions.expiresAt, revokedAt: tikisseAdminSessions.revokedAt, adminId: tikisseAdminUsers.id, email: tikisseAdminUsers.email, fullName: tikisseAdminUsers.fullName, role: tikisseAdminUsers.role, active: tikisseAdminUsers.active })
    .from(tikisseAdminSessions).innerJoin(tikisseAdminUsers, eq(tikisseAdminSessions.adminId, tikisseAdminUsers.id))
    .where(eq(tikisseAdminSessions.tokenHash, hashAdminSessionToken(input.token))).limit(1))[0];
  if (!pending || pending.stage !== "pending_totp" || pending.revokedAt || pending.expiresAt.getTime() <= Date.now() || !pending.active) {
    throw new Error("Session de connexion expirée. Reconnectez-vous.");
  }
  const attemptsKey = `admin-totp:${pending.adminId}:${Math.floor(Date.now() / ADMIN_LOGIN_WINDOW_MS)}`;
  const attempts = (await db.select({ count: tikisseRateLimits.count }).from(tikisseRateLimits).where(eq(tikisseRateLimits.rateLimitKey, attemptsKey)).limit(1))[0]?.count ?? 0;
  if (attempts >= TOTP_ATTEMPT_LIMIT) {
    await db.update(tikisseAdminSessions).set({ revokedAt: new Date() }).where(eq(tikisseAdminSessions.id, pending.sessionId));
    throw new Error("Trop de codes erronés. Reconnectez-vous dans quelques minutes.");
  }
  return db.transaction(async (tx) => {
    const factor = await consumeSecondFactor(tx, pending.adminId, input.code);
    if (!factor) {
      // Compté hors de la transaction qui échoue : l'échec doit rester enregistré.
      await db.insert(tikisseRateLimits).values({ rateLimitKey: attemptsKey, count: 1 }).onConflictDoUpdate({ target: tikisseRateLimits.rateLimitKey, set: { count: sql`${tikisseRateLimits.count} + 1` } });
      throw new Error("Code invalide.");
    }
    await tx.update(tikisseAdminSessions).set({ revokedAt: new Date() }).where(eq(tikisseAdminSessions.id, pending.sessionId));
    const session = await createAdminSession({ adminId: pending.adminId, ipAddress: input.ipAddress, userAgent: input.userAgent }, tx);
    await tx.update(tikisseAdminUsers).set({ lastLoginAt: new Date() }).where(eq(tikisseAdminUsers.id, pending.adminId));
    return { session, factor, admin: { id: pending.adminId, email: pending.email, fullName: pending.fullName, role: pending.role } };
  });
}

/** Premier temps de l'enrôlement : un secret neuf, pas encore actif tant qu'un code n'a pas été confirmé. */
export async function beginTotpEnrollment(input: { adminId: number; email: string }) {
  const db = await getDb();
  if (!db) throw new Error("La console d’administration est temporairement indisponible.");
  const account = (await db.select({ totpEnabledAt: tikisseAdminUsers.totpEnabledAt }).from(tikisseAdminUsers).where(eq(tikisseAdminUsers.id, input.adminId)).limit(1))[0];
  if (!account) throw new Error("Compte admin introuvable.");
  if (account.totpEnabledAt) throw new Error("La double authentification est déjà activée sur ce compte.");
  const secret = generateTotpSecret();
  await db.update(tikisseAdminUsers).set({ totpPendingSecret: encryptTotpSecret(secret) }).where(eq(tikisseAdminUsers.id, input.adminId));
  const uri = otpauthUri(input.email, secret);
  return { secret, otpauthUri: uri, qrSvg: await otpauthQrSvg(uri) };
}

/**
 * Second temps : le premier code prouve que l'application est bien configurée. Les codes de secours sont
 * rendus en clair cette seule fois ; seule leur empreinte est gardée.
 */
export async function confirmTotpEnrollment(input: { adminId: number; code: string }) {
  const db = await getDb();
  if (!db) throw new Error("La console d’administration est temporairement indisponible.");
  return db.transaction(async (tx) => {
    const account = (await tx.select().from(tikisseAdminUsers).where(eq(tikisseAdminUsers.id, input.adminId)).limit(1).for("update"))[0];
    if (!account) throw new Error("Compte admin introuvable.");
    if (account.totpEnabledAt) throw new Error("La double authentification est déjà activée sur ce compte.");
    if (!account.totpPendingSecret) throw new Error("Commencez par afficher le QR code d’enrôlement.");
    const step = matchTotpStep(decryptTotpSecret(account.totpPendingSecret), input.code);
    if (step === null) throw new Error("Code invalide. Vérifiez l’heure de votre téléphone et saisissez le code affiché.");
    const recoveryCodes = generateRecoveryCodes();
    await tx.update(tikisseAdminUsers).set({
      totpSecret: account.totpPendingSecret, totpPendingSecret: null, totpEnabledAt: new Date(), totpLastUsedStep: step,
      totpRecoveryCodes: JSON.stringify(recoveryCodes.map(hashRecoveryCode)),
    }).where(eq(tikisseAdminUsers.id, input.adminId));
    return { recoveryCodes };
  });
}

function clearedTotp() {
  return { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastUsedStep: null, totpRecoveryCodes: null };
}

/** Désactivation par le titulaire, avec un code valide, et seulement si son rôle n'y est pas obligé. */
export async function disableOwnTotp(input: { adminId: number; role: AdminRole; code: string }) {
  const db = await getDb();
  if (!db) throw new Error("La console d’administration est temporairement indisponible.");
  if (isTotpRequiredRole(input.role) && await isAdminTotpRequired(db)) throw new Error("La double authentification est obligatoire pour votre rôle : elle ne peut pas être désactivée.");
  await db.transaction(async (tx) => {
    const factor = await consumeSecondFactor(tx, input.adminId, input.code);
    if (!factor) throw new Error("Code invalide.");
    await tx.update(tikisseAdminUsers).set(clearedTotp()).where(eq(tikisseAdminUsers.id, input.adminId));
  });
}

/**
 * Téléphone perdu : un super-admin retire la double authentification d'un autre compte, qui devra se
 * réenrôler. Ses sessions sont coupées. Jamais sur son propre compte (il passerait outre son propre facteur).
 */
export async function resetAdminTotp(input: { actorAdminId: number; adminId: number }) {
  if (input.actorAdminId === input.adminId) throw new Error("Vous ne pouvez pas réinitialiser votre propre double authentification. Utilisez un code de secours, ou demandez à un autre super-admin.");
  const db = await getDb();
  if (!db) throw new Error("La console d’administration est temporairement indisponible.");
  await db.transaction(async (tx) => {
    const target = (await tx.select({ id: tikisseAdminUsers.id }).from(tikisseAdminUsers).where(eq(tikisseAdminUsers.id, input.adminId)).limit(1).for("update"))[0];
    if (!target) throw new Error("Compte admin introuvable.");
    await tx.update(tikisseAdminUsers).set(clearedTotp()).where(eq(tikisseAdminUsers.id, input.adminId));
    await revokeAllAdminSessions(input.adminId, tx);
  });
}

/**
 * Rendre la double authentification obligatoire pour super_admin et finance. Refusé tant qu'un de ces
 * comptes actifs n'est pas enrôlé — l'auteur de la décision compris : personne ne se retrouve bloqué.
 * (Un compte créé ensuite par le script serveur n'est pas bloqué non plus : il n'accède qu'à son enrôlement.)
 */
export async function setAdminTotpRequired(input: { actorAdminId: number; required: boolean }) {
  const db = await getDb();
  if (!db) throw new Error("La console d’administration est temporairement indisponible.");
  if (input.required) {
    const missing = await db.select({ email: tikisseAdminUsers.email }).from(tikisseAdminUsers)
      .where(and(eq(tikisseAdminUsers.active, true), inArray(tikisseAdminUsers.role, [...TOTP_REQUIRED_ROLES]), isNull(tikisseAdminUsers.totpEnabledAt)));
    if (missing.length > 0) throw new Error(`Impossible d’exiger la double authentification : ${missing.length} compte(s) super-admin ou finance ne l’ont pas encore activée (${missing.map((row) => row.email).join(", ")}).`);
  }
  await db.insert(tikissePlatformSettings).values({ id: 1, adminTotpRequired: input.required }).onConflictDoUpdate({ target: tikissePlatformSettings.id, set: { adminTotpRequired: input.required } });
  return { required: input.required };
}

// ————————————————————————————————————————————————————————————————————————
// Limiteur de connexion admin, partagé entre instances (tikisse_rate_limits)
// ————————————————————————————————————————————————————————————————————————

/**
 * Échecs de connexion tolérés par fenêtre de 15 minutes. Trois compteurs, parce qu'un seul ne suffit pas :
 *  - email + IP : l'essai de mots de passe classique, bloqué vite ;
 *  - email seul : le même compte attaqué depuis de nombreuses IP (l'ancien limiteur, clé IP + email, se
 *    contournait en changeant d'IP) ;
 *  - IP seule : une même machine qui essaie de nombreux emails.
 * Stocké en base et non plus dans la mémoire du processus : un redémarrage ne remet plus les compteurs à
 * zéro, et plusieurs instances partagent les mêmes.
 */
export const ADMIN_LOGIN_WINDOW_MS = 15 * 60_000;
export const ADMIN_LOGIN_LIMITS = { emailIp: 5, email: 20, ip: 30 } as const;

function adminLoginKeys(email: string, ip: string, now = Date.now()) {
  const bucket = Math.floor(now / ADMIN_LOGIN_WINDOW_MS);
  const normalizedEmail = email.trim().toLowerCase();
  return {
    emailIp: `admin-login:email-ip:${normalizedEmail}:${ip}:${bucket}`.slice(0, 191),
    email: `admin-login:email:${normalizedEmail}:${bucket}`.slice(0, 191),
    ip: `admin-login:ip:${ip}:${bucket}`.slice(0, 191),
  };
}

export async function assertAdminLoginAllowed(email: string, ip: string) {
  const db = await getDb();
  if (!db) throw new Error("La console d’administration est temporairement indisponible.");
  const keys = adminLoginKeys(email, ip);
  const rows = await db.select().from(tikisseRateLimits).where(inArray(tikisseRateLimits.rateLimitKey, Object.values(keys)));
  const failures = (key: string) => rows.find((row) => row.rateLimitKey === key)?.count ?? 0;
  if (failures(keys.emailIp) >= ADMIN_LOGIN_LIMITS.emailIp || failures(keys.email) >= ADMIN_LOGIN_LIMITS.email || failures(keys.ip) >= ADMIN_LOGIN_LIMITS.ip) {
    throw new Error("Trop de tentatives de connexion. Réessayez dans quelques minutes.");
  }
}

export async function recordAdminLoginFailure(email: string, ip: string) {
  const db = await getDb();
  if (!db) return;
  for (const rateLimitKey of Object.values(adminLoginKeys(email, ip))) {
    await db.insert(tikisseRateLimits).values({ rateLimitKey, count: 1 }).onConflictDoUpdate({ target: tikisseRateLimits.rateLimitKey, set: { count: sql`${tikisseRateLimits.count} + 1` } });
  }
}

/** Une connexion réussie efface les échecs de ce couple email + IP, pas les compteurs globaux. */
export async function recordAdminLoginSuccess(email: string, ip: string) {
  const db = await getDb();
  if (!db) return;
  await db.delete(tikisseRateLimits).where(eq(tikisseRateLimits.rateLimitKey, adminLoginKeys(email, ip).emailIp));
}

// ————————————————————————————————————————————————————————————————————————
// Journal d'audit (append-only : jamais d'update/delete depuis l'application)
// ————————————————————————————————————————————————————————————————————————

export async function writeAdminAuditLog(entry: { adminId: number; adminEmail: string; action: string; targetType: string; targetId: string; details?: unknown; ipAddress?: string }) {
  const db = await getDb();
  if (!db) return;
  await db.insert(tikisseAdminAuditLog).values({
    id: randomUUID(),
    adminId: entry.adminId,
    adminEmail: entry.adminEmail,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    details: entry.details !== undefined ? JSON.stringify(entry.details) : null,
    ipAddress: entry.ipAddress ?? null,
  });
}

/**
 * Par défaut, le journal montre les actions détaillées ; les traces de demande (`admin_request`, écrites
 * avant chaque modification) n'apparaissent qu'à la demande, ou quand on filtre explicitement dessus.
 */
export type AuditLogFilter = { includeRequests?: boolean; targetType?: string; targetId?: string; adminEmail?: string; action?: string; from?: Date; to?: Date };

export async function listAdminAuditLog(input: AuditLogFilter & { limit?: number; offset?: number }, maxLimit = 200) {
  const db = await getDb();
  if (!db) return { rows: [] as Array<{ id: string; adminEmail: string; action: string; targetType: string; targetId: string; details: string | null; createdAt: Date; ipAddress: string | null }>, total: 0 };
  const limit = Math.min(input.limit ?? 50, maxLimit);
  const offset = Math.max(input.offset ?? 0, 0);
  const conditions = [
    input.targetType ? eq(tikisseAdminAuditLog.targetType, input.targetType) : undefined,
    input.targetId ? eq(tikisseAdminAuditLog.targetId, input.targetId) : undefined,
    !input.includeRequests && !input.targetType ? ne(tikisseAdminAuditLog.targetType, "admin_request") : undefined,
    input.adminEmail ? eq(tikisseAdminAuditLog.adminEmail, input.adminEmail.trim().toLowerCase()) : undefined,
    // Préfixe : « wallet » retrouve wallet_bonus_credited comme wallet_penalty_applied.
    input.action ? ilike(tikisseAdminAuditLog.action, `${input.action.trim().replace(/[\\%_]/g, (char) => `\\${char}`)}%`) : undefined,
    input.from ? gte(tikisseAdminAuditLog.createdAt, input.from) : undefined,
    input.to ? lt(tikisseAdminAuditLog.createdAt, input.to) : undefined,
  ].filter((value): value is NonNullable<typeof value> => Boolean(value));
  const where = conditions.length ? and(...conditions) : undefined;
  const [rows, totalResult] = await Promise.all([
    db.select().from(tikisseAdminAuditLog).where(where).orderBy(desc(tikisseAdminAuditLog.createdAt)).limit(limit).offset(offset),
    db.select({ count: count() }).from(tikisseAdminAuditLog).where(where),
  ]);
  return { rows, total: Number(totalResult[0]?.count ?? 0) };
}

// ————————————————————————————————————————————————————————————————————————
// Configuration de la commission (CAS §3.1 : configurable depuis l'administration)
// ————————————————————————————————————————————————————————————————————————

export async function adminUpdateCommissionRate(rate: number) {
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) throw new Error("Le taux de commission doit être strictement compris entre 0 et 1 (ex. 0.10 pour 10 %).");
  const db = await getDb();
  if (!db) throw new Error("La console d’administration est temporairement indisponible.");
  await db.insert(tikissePlatformSettings).values({ id: 1, commissionRate: rate.toFixed(5) }).onConflictDoUpdate({ target: tikissePlatformSettings.id, set: { commissionRate: rate.toFixed(5) } });
  return { rate };
}

// ————————————————————————————————————————————————————————————————————————
// Signalements (CAS N°9)
// ————————————————————————————————————————————————————————————————————————

export async function createDeliveryReport(input: { deliveryId: string; reporterPhone: string; reporterRole: "sender" | "driver"; reason: string; description: string; attachmentKey?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Les signalements sont temporairement indisponibles.");
  const id = randomUUID();
  await db.insert(tikisseDeliveryReports).values({ id, deliveryId: input.deliveryId, reporterPhone: input.reporterPhone, reporterRole: input.reporterRole, reason: input.reason, description: input.description, attachmentKey: input.attachmentKey ?? null });
  await db.insert(tikisseDeliveryEvents).values({
    id: randomUUID(), deliveryId: input.deliveryId, eventType: "delivery_reported", status: null, actorPhone: input.reporterPhone,
    recipientPhone: input.reporterPhone, title: "Signalement envoyé", body: "Votre signalement a été transmis à l’administration Tikisse.", tone: "info",
    idempotencyKey: `${id}:report-ack`,
  });
  return { id };
}

export async function listDeliveryReports(input: { status?: "open" | "reviewing" | "resolved" | "dismissed"; limit?: number }) {
  const db = await getDb();
  if (!db) return [];
  const base = db.select({
    report: tikisseDeliveryReports,
    delivery: { id: tikisseDeliveries.id, title: tikisseDeliveries.title, status: tikisseDeliveries.status, senderPhone: tikisseDeliveries.senderPhone, driverPhone: tikisseDeliveries.driverPhone },
  }).from(tikisseDeliveryReports).innerJoin(tikisseDeliveries, eq(tikisseDeliveryReports.deliveryId, tikisseDeliveries.id));
  const filtered = input.status ? base.where(eq(tikisseDeliveryReports.status, input.status)) : base;
  return filtered.orderBy(desc(tikisseDeliveryReports.createdAt)).limit(Math.min(input.limit ?? 100, 500));
}

export async function getDeliveryReportById(reportId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(tikisseDeliveryReports).where(eq(tikisseDeliveryReports.id, reportId)).limit(1);
  return rows[0];
}

const CLOSED_REPORT_STATUSES = ["resolved", "dismissed"] as const;
const isClosedReportStatus = (status: string) => (CLOSED_REPORT_STATUSES as readonly string[]).includes(status);

/**
 * Décision sur un signalement, sous verrou.
 *  - Clore (résolu, classé) prévient l'auteur dans l'app, avec le message qui lui est destiné s'il y en a
 *    un. Les notes de résolution, elles, restent internes.
 *  - Un signalement clos ne se reclôt pas d'un autre verdict : il faut d'abord le rouvrir (« en cours »),
 *    ce qui efface la date et l'auteur de la clôture précédente. Avant, la clôture restait affichée sur un
 *    dossier rouvert, et un second verdict remplaçait le premier sans que rien ne le signale.
 */
export async function resolveDeliveryReport(input: { reportId: string; status: "reviewing" | "resolved" | "dismissed"; resolutionNotes?: string; replyToReporter?: string; adminId: number }) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  const previousStatus = await dbc.transaction(async (tx) => {
    const report = (await tx.select().from(tikisseDeliveryReports).where(eq(tikisseDeliveryReports.id, input.reportId)).limit(1).for("update"))[0];
    if (!report) throw new Error("Signalement introuvable.");
    const closing = isClosedReportStatus(input.status);
    if (closing && isClosedReportStatus(report.status)) throw new Error("Ce signalement est déjà clos. Rouvrez-le (« en cours ») avant de rendre une autre décision.");
    await tx.update(tikisseDeliveryReports).set({
      status: input.status,
      resolutionNotes: input.resolutionNotes ?? report.resolutionNotes ?? null,
      ...(closing ? { resolvedAt: new Date(), resolvedByAdminId: input.adminId } : { resolvedAt: null, resolvedByAdminId: null }),
    }).where(eq(tikisseDeliveryReports.id, input.reportId));
    if (closing) {
      const reply = input.replyToReporter?.trim();
      const verdict = input.status === "resolved" ? "Votre signalement a été traité par l’équipe Tikisse." : "Votre signalement a été examiné et classé sans suite.";
      await db.appendDeliveryEvent(tx, {
        deliveryId: report.deliveryId, eventType: "report_decision", recipientPhone: report.reporterPhone,
        title: input.status === "resolved" ? "Signalement traité" : "Signalement classé",
        body: reply ? `${verdict} ${reply}` : verdict, tone: input.status === "resolved" ? "success" : "info",
        // Une décision par clôture : un signalement rouvert puis reclos notifie de nouveau.
        idempotencyKey: `${report.id}:decision:${randomUUID()}`,
      });
    }
    return report.status;
  });
  return { report: await getDeliveryReportById(input.reportId), previousStatus };
}

// ————————————————————————————————————————————————————————————————————————
// Console de litiges (CAS N°10) : chronologie complète d'une livraison
// ————————————————————————————————————————————————————————————————————————

export async function adminSearchDeliveries(input: { query?: string; status?: string; limit?: number }) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [
    input.query ? or(eq(tikisseDeliveries.id, input.query), like(tikisseDeliveries.senderPhone, `${input.query}%`), like(tikisseDeliveries.driverPhone, `${input.query}%`), ilike(tikisseDeliveries.title, `${input.query}%`)) : undefined,
    input.status ? eq(tikisseDeliveries.status, input.status as TikisseDelivery["status"]) : undefined,
  ].filter((value): value is NonNullable<typeof value> => Boolean(value));
  return db.select().from(tikisseDeliveries).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(tikisseDeliveries.createdAt)).limit(Math.min(input.limit ?? 50, 200));
}

/** Chronologie complète d'une livraison pour instruction d'un litige : statut, candidatures,
 *  mouvements financiers de chaque partie prenante, événements/notifications, signalements. */
export async function adminGetDeliveryTimeline(deliveryId: string) {
  const db = await getDb();
  if (!db) return null;
  const delivery = (await db.select().from(tikisseDeliveries).where(eq(tikisseDeliveries.id, deliveryId)).limit(1))[0];
  if (!delivery) return null;
  const candidates = await db.select().from(tikisseDeliveryCandidates).where(eq(tikisseDeliveryCandidates.deliveryId, deliveryId)).orderBy(desc(tikisseDeliveryCandidates.createdAt));
  const events = await db.select().from(tikisseDeliveryEvents).where(eq(tikisseDeliveryEvents.deliveryId, deliveryId)).orderBy(tikisseDeliveryEvents.createdAt);
  const ledgerEntries = await db.select().from(tikisseWalletLedger).where(eq(tikisseWalletLedger.deliveryId, deliveryId)).orderBy(tikisseWalletLedger.createdAt);
  const reports = await db.select().from(tikisseDeliveryReports).where(eq(tikisseDeliveryReports.deliveryId, deliveryId)).orderBy(desc(tikisseDeliveryReports.createdAt));
  return { delivery, candidates, events, ledgerEntries, reports };
}

// ————————————————————————————————————————————————————————————————————————
// Utilisateurs et Wallets (support niveau 1, lecture + actions encadrées)
// ————————————————————————————————————————————————————————————————————————

export async function adminSearchProfiles(input: { query?: string; limit?: number; offset?: number }) {
  const db = await getDb();
  if (!db) return { rows: [] as Array<{ phone: string; fullName: string; accountType: "sender" | "driver"; email: string | null; phoneVerified: boolean; emailVerified: boolean; status?: "active" | "suspended" | "banned"; statusReason?: string | null; createdAt: Date }>, total: 0 };
  const limit = Math.min(input.limit ?? 30, 100);
  const offset = Math.max(input.offset ?? 0, 0);
  const query = input.query?.trim();
  const where = query
    ? or(like(tikisseProfiles.phone, `${query}%`), ilike(tikisseProfiles.fullName, `${query}%`), ilike(tikisseProfiles.email, `${query}%`))
    : undefined;
  const [rows, totalResult] = await Promise.all([
    db.select().from(tikisseProfiles).where(where).orderBy(desc(tikisseProfiles.createdAt)).limit(limit).offset(offset),
    db.select({ count: count() }).from(tikisseProfiles).where(where),
  ]);
  return { rows, total: Number(totalResult[0]?.count ?? 0) };
}

export async function adminGetProfileDetail(phone: string) {
  const db = await getDb();
  if (!db) return null;
  const profile = (await db.select().from(tikisseProfiles).where(eq(tikisseProfiles.phone, phone)).limit(1))[0];
  if (!profile) return null;
  const wallet = (await db.select().from(tikisseWallets).where(eq(tikisseWallets.profilePhone, phone)).limit(1))[0] ?? null;
  const ledger = await db.select().from(tikisseWalletLedger).where(eq(tikisseWalletLedger.profilePhone, phone)).orderBy(desc(tikisseWalletLedger.createdAt)).limit(100);
  const deliveriesAsSender = await db.select({ count: count() }).from(tikisseDeliveries).where(eq(tikisseDeliveries.senderPhone, phone));
  const deliveriesAsDriver = await db.select({ count: count() }).from(tikisseDeliveries).where(eq(tikisseDeliveries.driverPhone, phone));
  return { profile, wallet, ledger, deliveriesAsSenderCount: Number(deliveriesAsSender[0]?.count ?? 0), deliveriesAsDriverCount: Number(deliveriesAsDriver[0]?.count ?? 0) };
}

// ————————————————————————————————————————————————————————————————————————
// Tableau de bord : indicateurs agrégés
// ————————————————————————————————————————————————————————————————————————

export async function adminDashboardMetrics(sinceDays = 30) {
  const db = await getDb();
  if (!db) return null;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const now = new Date();
  // Une course « terminée sur la période » l'a été pendant la période (completedAt), quelle que soit sa date
  // de publication. Compter par date de création sous-estimait les courses publiées juste avant la période
  // et terminées pendant, et gonflait la période suivante de courses publiées mais pas encore terminées.
  const completedInPeriod = and(eq(tikisseDeliveries.status, "completed"), gte(tikisseDeliveries.completedAt, since));
  const ledgerTotal = (operation: "commission_debit" | "compensation") => db.select({ total: sql<number>`coalesce(sum(${tikisseWalletLedger.amount}), 0)`.mapWith(Number) }).from(tikisseWalletLedger)
    .where(and(eq(tikisseWalletLedger.operation, operation), gte(tikisseWalletLedger.createdAt, since), lte(tikisseWalletLedger.createdAt, now)));
  const [deliveriesTotal, deliveriesCompleted, openReports, activeDrivers, commissionGross, commissionRefunds, recentDeliveries, recentCompletions] = await Promise.all([
    db.select({ count: count() }).from(tikisseDeliveries).where(gte(tikisseDeliveries.createdAt, since)),
    db.select({ count: count() }).from(tikisseDeliveries).where(completedInPeriod),
    db.select({ count: count() }).from(tikisseDeliveryReports).where(eq(tikisseDeliveryReports.status, "open")),
    db.select({ count: sql<number>`count(distinct ${tikisseDeliveries.driverPhone})`.mapWith(Number) }).from(tikisseDeliveries).where(completedInPeriod),
    // "commission_debit" est le seul mouvement qui correspond à un revenu réel de Tikisse ; "debit" générique
    // couvre aussi les retraits (argent des utilisateurs qui sort de leur propre Wallet), à ne jamais compter ici.
    ledgerTotal("commission_debit"),
    // Toute "compensation" rend une commission déjà prélevée (livreur remplacé, course expirée ou annulée par
    // l'administration) : c'est du revenu qui repart. Sans la retrancher, le tableau de bord comptait ces
    // commissions comme acquises.
    ledgerTotal("compensation"),
    db.select({ createdAt: tikisseDeliveries.createdAt, status: tikisseDeliveries.status, vehicleTypes: tikisseDeliveries.vehicleTypes }).from(tikisseDeliveries).where(gte(tikisseDeliveries.createdAt, since)),
    db.select({ completedAt: tikisseDeliveries.completedAt }).from(tikisseDeliveries).where(completedInPeriod),
  ]);

  // Timeseries par jour
  const byDay = new Map<string, { published: number; completed: number }>();
  for (let i = 0; i < sinceDays; i += 1) {
    const d = new Date(Date.now() - (sinceDays - 1 - i) * 24 * 60 * 60 * 1000);
    byDay.set(d.toISOString().slice(0, 10), { published: 0, completed: 0 });
  }
  for (const d of recentDeliveries) {
    const slot = byDay.get(d.createdAt.toISOString().slice(0, 10));
    if (slot) slot.published += 1;
  }
  for (const d of recentCompletions) {
    const slot = d.completedAt ? byDay.get(d.completedAt.toISOString().slice(0, 10)) : undefined;
    if (slot) slot.completed += 1;
  }
  const timeseries = Array.from(byDay.entries()).map(([date, slot]) => ({ date, ...slot }));

  // Vehicle breakdown
  const vehicleCounts = new Map<string, number>();
  for (const d of recentDeliveries) {
    const first = d.vehicleTypes?.split(",")[0]?.trim();
    if (!first) continue;
    vehicleCounts.set(first, (vehicleCounts.get(first) ?? 0) + 1);
  }
  const vehicleBreakdown = Array.from(vehicleCounts.entries())
    .map(([vehicle, count]) => ({ vehicle, count }))
    .sort((a, b) => b.count - a.count);

  return {
    periodDays: sinceDays,
    deliveriesTotal: Number(deliveriesTotal[0]?.count ?? 0),
    deliveriesCompleted: Number(deliveriesCompleted[0]?.count ?? 0),
    openReports: Number(openReports[0]?.count ?? 0),
    activeDrivers: Number(activeDrivers[0]?.count ?? 0),
    /** Revenu net : commissions prélevées moins commissions rendues sur la période. */
    commissionRevenue: Number(commissionGross[0]?.total ?? 0) - Number(commissionRefunds[0]?.total ?? 0),
    commissionGross: Number(commissionGross[0]?.total ?? 0),
    commissionRefunds: Number(commissionRefunds[0]?.total ?? 0),
    timeseries,
    vehicleBreakdown,
  };
}

// ————————————————————————————————————————————————————————————————————————
// Gestion complète des utilisateurs : rôle, statut (suspension/bannissement/interdiction)
// ————————————————————————————————————————————————————————————————————————

export type ProfileStatus = "active" | "suspended" | "banned";

export type ProfileEngagement = { deliveryId: string; title: string; status: TikisseDelivery["status"]; role: "sender" | "driver" };

/** Courses où ce profil est engagé et qu'une décision d'admin ne peut pas trancher à sa place. */
async function profileEngagements(tx: any, phone: string): Promise<ProfileEngagement[]> {
  const asDriver = await tx.select({ deliveryId: tikisseDeliveries.id, title: tikisseDeliveries.title, status: tikisseDeliveries.status }).from(tikisseDeliveries)
    .where(and(eq(tikisseDeliveries.driverPhone, phone), inArray(tikisseDeliveries.status, ["pending_confirmation", "active"])));
  const asSender = await tx.select({ deliveryId: tikisseDeliveries.id, title: tikisseDeliveries.title, status: tikisseDeliveries.status }).from(tikisseDeliveries)
    .where(and(eq(tikisseDeliveries.senderPhone, phone), inArray(tikisseDeliveries.status, ["open", "pending_confirmation", "active", "disabled"])));
  return [
    ...asDriver.map((row: Omit<ProfileEngagement, "role">) => ({ ...row, role: "driver" as const })),
    ...asSender.map((row: Omit<ProfileEngagement, "role">) => ({ ...row, role: "sender" as const })),
  ];
}

/**
 * Suspendre ou bannir retire aussi les candidatures ouvertes du profil et libère leur commission (voir
 * `withdrawCandidaciesOfSuspendedDriver`), dans la même transaction que le changement de statut. Les courses
 * déjà attribuées ou publiées sont renvoyées dans `engagements` : l'admin décide de les annuler ou non.
 */
export async function adminSetProfileStatus(input: { phone: string; status: ProfileStatus; reason?: string; adminId: number }) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  return dbc.transaction(async (tx) => {
    const profile = (await tx.select().from(tikisseProfiles).where(eq(tikisseProfiles.phone, input.phone)).limit(1).for("update"))[0];
    if (!profile) throw new Error("Profil introuvable.");
    await tx.update(tikisseProfiles).set({
      status: input.status,
      statusReason: input.status === "active" ? null : (input.reason?.trim() || null),
      statusUpdatedAt: new Date(),
      statusUpdatedByAdminId: input.adminId,
    }).where(eq(tikisseProfiles.phone, input.phone));
    const releasedCandidacies = input.status === "active" ? 0 : await db.withdrawCandidaciesOfSuspendedDriver(tx, input.phone);
    const engagements = input.status === "active" ? [] : await profileEngagements(tx, input.phone);
    return { phone: input.phone, status: input.status, releasedCandidacies, engagements };
  });
}

/** Le rôle (sender/driver) est normalement immuable côté app ; ce changement est réservé aux super-admins
 *  pour corriger une erreur d'inscription ou une demande explicite de l'utilisateur. */
export async function adminChangeProfileRole(input: { phone: string; role: "sender" | "driver" }) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  return dbc.transaction(async (tx) => {
    const profile = (await tx.select().from(tikisseProfiles).where(eq(tikisseProfiles.phone, input.phone)).limit(1).for("update"))[0];
    if (!profile) throw new Error("Profil introuvable.");
    // Tout ce qui lie encore ce profil à son rôle actuel bloque le changement. Ne regarder que les courses
    // « en cours » laissait passer un livreur avec des candidatures ouvertes : devenu expéditeur, il n'avait
    // plus aucun écran pour les retirer, et leur commission restait réservée pour toujours.
    const candidacies = await tx.select({ count: count() }).from(tikisseDeliveryCandidates)
      .where(and(eq(tikisseDeliveryCandidates.driverPhone, input.phone), inArray(tikisseDeliveryCandidates.status, ["applied", "selected", "confirmed"])));
    if (Number(candidacies[0]?.count ?? 0) > 0) throw new Error("Impossible de changer le rôle : ce livreur a une candidature en cours. Elle doit d’abord être retirée ou la course terminée.");
    const engagements = await profileEngagements(tx, input.phone);
    if (engagements.length > 0) throw new Error(`Impossible de changer le rôle : ce profil a ${engagements.length} course(s) non terminée(s).`);
    const wallet = (await tx.select().from(tikisseWallets).where(eq(tikisseWallets.profilePhone, input.phone)).limit(1))[0];
    if (wallet && wallet.heldBalance > 0) throw new Error("Impossible de changer le rôle : une partie du Wallet de ce profil est encore bloquée.");
    await tx.update(tikisseProfiles).set({ accountType: input.role, vehicles: input.role === "sender" ? "[]" : profile.vehicles }).where(eq(tikisseProfiles.phone, input.phone));
    return { phone: input.phone, role: input.role };
  });
}

export async function adminRewardWallet(input: { phone: string; amount: number; reason: string; adminId: number; requestId: string }) {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > 1_000_000) throw new Error("Montant de récompense invalide.");
  // `requestId` est généré une seule fois côté client au moment du clic : un double-clic ou une
  // relance réseau renvoie le même identifiant et ne produit donc jamais un second crédit réel.
  // La clé porte aussi le numéro : `applyWalletMovement` rend le mouvement déjà enregistré sous une clé
  // connue sans regarder à qui il appartenait. Un identifiant réutilisé pour un autre profil (brouillon
  // conservé d'une fiche à l'autre) aurait « réussi » sans rien créditer à ce profil-là.
  return db.adminAdjustWallet({ profilePhone: input.phone, amount: input.amount, direction: "credit", operation: "bonus", reason: input.reason || "Bonus accordé par l’administration", idempotencyKey: `admin-reward:${input.phone}:${input.requestId}` });
}

export async function adminPenalizeWallet(input: { phone: string; amount: number; reason: string; adminId: number; requestId: string }) {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > 1_000_000) throw new Error("Montant de pénalité invalide.");
  return db.adminAdjustWallet({ profilePhone: input.phone, amount: input.amount, direction: "debit", operation: "penalty", reason: input.reason || "Pénalité appliquée par l’administration", idempotencyKey: `admin-penalty:${input.phone}:${input.requestId}` });
}

// ————————————————————————————————————————————————————————————————————————
// Gestion complète des livraisons
// ————————————————————————————————————————————————————————————————————————

export async function adminListDeliveries(input: { query?: string; status?: string; role?: "sender" | "driver"; from?: Date; to?: Date; limit?: number }) {
  const dbc = await getDb();
  if (!dbc) return [];
  const conditions = [
    input.query ? or(eq(tikisseDeliveries.id, input.query), like(tikisseDeliveries.senderPhone, `%${input.query}%`), like(tikisseDeliveries.driverPhone, `%${input.query}%`), ilike(tikisseDeliveries.title, `%${input.query}%`)) : undefined,
    input.status ? eq(tikisseDeliveries.status, input.status as TikisseDelivery["status"]) : undefined,
    input.from ? gte(tikisseDeliveries.createdAt, input.from) : undefined,
    input.to ? lte(tikisseDeliveries.createdAt, input.to) : undefined,
  ].filter((value): value is NonNullable<typeof value> => Boolean(value));
  return dbc.select().from(tikisseDeliveries).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(tikisseDeliveries.createdAt)).limit(Math.min(input.limit ?? 50, 200));
}

/** Liste les positions GPS encore fraiches des livraisons en cours.
 *  Utilisé par la page admin "Carte temps réel" (projection bounding box SVG). */
export async function adminListLiveLocations(input: { maxAgeSeconds: number }) {
  const dbc = await getDb();
  if (!dbc) return [];
  const minUpdatedAt = new Date(Date.now() - input.maxAgeSeconds * 1000);
  const rows = await dbc
    .select({
      deliveryId: tikisseDeliveryLiveLocations.deliveryId,
      driverPhone: tikisseDeliveryLiveLocations.driverPhone,
      latitude: tikisseDeliveryLiveLocations.latitude,
      longitude: tikisseDeliveryLiveLocations.longitude,
      heading: tikisseDeliveryLiveLocations.heading,
      recordedAt: tikisseDeliveryLiveLocations.recordedAt,
      updatedAt: tikisseDeliveryLiveLocations.updatedAt,
    })
    .from(tikisseDeliveryLiveLocations)
    .where(gte(tikisseDeliveryLiveLocations.updatedAt, minUpdatedAt))
    .orderBy(desc(tikisseDeliveryLiveLocations.updatedAt))
    .limit(200);
  return rows.map((row) => ({
    deliveryId: row.deliveryId,
    driverPhone: row.driverPhone,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    heading: Number(row.heading),
    recordedAt: row.recordedAt instanceof Date ? row.recordedAt.toISOString() : String(row.recordedAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  }));
}

/** Annulation forcée par l'administration : libère toute commission bloquée/prélevée, quel que soit
 *  le statut (y compris active/pending_confirmation), contrairement à l'annulation Sender classique
 *  qui est bloquée après mise en relation (CAS N°6). Réservé aux litiges tranchés par un admin. */
export async function adminForceCancelDelivery(input: { deliveryId: string; reason: string; adminId: number }) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  return dbc.transaction(async (tx) => {
    const delivery = (await tx.select().from(tikisseDeliveries).where(eq(tikisseDeliveries.id, input.deliveryId)).limit(1).for("update"))[0];
    if (!delivery) throw new Error("Livraison introuvable.");
    if (delivery.status === "completed" || delivery.status === "cancelled" || delivery.status === "expired") throw new Error("Cette livraison est déjà clôturée.");
    // Libère la commission de tout candidat encore engagé (selected/confirmed/applied).
    const candidates = await tx.select().from(tikisseDeliveryCandidates).where(and(eq(tikisseDeliveryCandidates.deliveryId, input.deliveryId), or(eq(tikisseDeliveryCandidates.status, "applied"), eq(tikisseDeliveryCandidates.status, "selected"), eq(tikisseDeliveryCandidates.status, "confirmed")))).for("update");
    for (const candidate of candidates) {
      // Deux situations très différentes, à ne jamais confondre (même règle que l'expiration automatique,
      // `expireOpenTikisseDeliveries`) :
      //  - commission réellement prélevée (candidat confirmé) : elle a quitté le Wallet, on la rembourse ;
      //  - commission seulement réservée (candidat postulé ou sélectionné) : elle est encore dans le solde
      //    bloqué, on la débloque. La créditer au disponible sans vider la réserve fabriquait de l'argent :
      //    le livreur retrouvait sa commission ET la gardait bloquée, sans aucun parcours pour la libérer.
      // Même transaction que les mises à jour de statut ci-dessous (via `tx`) : si une étape échoue plus
      // loin, ce mouvement fait partie du rollback. Clés déterministes par candidat : une relance ne peut
      // jamais rembourser ni débloquer deux fois.
      const debits = await tx.select().from(tikisseWalletLedger).where(and(eq(tikisseWalletLedger.deliveryId, input.deliveryId), eq(tikisseWalletLedger.profilePhone, candidate.driverPhone), inArray(tikisseWalletLedger.operation, ["debit", "commission_debit"]))).for("update");
      const debitedAmount = debits.reduce((total, entry) => total + Number(entry.amount), 0);
      if (debitedAmount > 0) {
        await db.applyWalletMovement(tx, { profilePhone: candidate.driverPhone, deliveryId: input.deliveryId, operation: "compensation", amount: debitedAmount, availableDelta: debitedAmount, heldDelta: 0, reason: `Annulation administrative de la livraison ${input.deliveryId} : commission remboursée`, idempotencyKey: `${input.deliveryId}:admin-force-cancel:${candidate.id}` });
      } else if (candidate.commissionBlocked > 0) {
        await db.applyWalletMovement(tx, { profilePhone: candidate.driverPhone, deliveryId: input.deliveryId, operation: "unblock", amount: candidate.commissionBlocked, availableDelta: candidate.commissionBlocked, heldDelta: -candidate.commissionBlocked, reason: `Annulation administrative de la livraison ${input.deliveryId} : commission libérée`, idempotencyKey: `${input.deliveryId}:admin-force-cancel-unblock:${candidate.id}` });
      }
      await tx.update(tikisseDeliveryCandidates).set({ status: "withdrawn", updatedAt: new Date() }).where(eq(tikisseDeliveryCandidates.id, candidate.id));
    }
    await tx.update(tikisseDeliveries).set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() }).where(eq(tikisseDeliveries.id, input.deliveryId));
    await tx.insert(tikisseDeliveryEvents).values({ id: randomUUID(), deliveryId: input.deliveryId, eventType: "admin_cancelled", status: "cancelled", actorPhone: null, recipientPhone: delivery.senderPhone, title: "Livraison annulée par l’administration", body: input.reason || "Cette livraison a été annulée après examen par l’équipe Tikisse.", tone: "warning", idempotencyKey: `${input.deliveryId}:admin-cancel` }).onConflictDoNothing();
    if (delivery.driverPhone) {
      await tx.insert(tikisseDeliveryEvents).values({ id: randomUUID(), deliveryId: input.deliveryId, eventType: "admin_cancelled", status: "cancelled", actorPhone: null, recipientPhone: delivery.driverPhone, title: "Livraison annulée par l’administration", body: input.reason || "Cette livraison a été annulée après examen par l’équipe Tikisse.", tone: "warning", idempotencyKey: `${input.deliveryId}:admin-cancel-driver` }).onConflictDoNothing();
    }
    return { id: input.deliveryId, status: "cancelled" as const };
  });
}

// ————————————————————————————————————————————————————————————————————————
// Parrainage
// ————————————————————————————————————————————————————————————————————————

export async function adminListReferrals(input: { status?: "invited" | "qualified" | "rewarded" | "voided"; limit?: number }) {
  const dbc = await getDb();
  if (!dbc) return [];
  const base = dbc.select().from(tikisseReferrals);
  const filtered = input.status ? base.where(eq(tikisseReferrals.status, input.status)) : base;
  return filtered.orderBy(desc(tikisseReferrals.createdAt)).limit(Math.min(input.limit ?? 100, 500));
}

export async function adminRewardReferral(input: { referralId: string; adminId: number }) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  return dbc.transaction(async (tx) => {
    const referral = (await tx.select().from(tikisseReferrals).where(eq(tikisseReferrals.id, input.referralId)).limit(1).for("update"))[0];
    if (!referral) throw new Error("Parrainage introuvable.");
    if (referral.status !== "qualified") throw new Error("Ce parrainage n’est pas (ou plus) éligible à une récompense.");
    await tx.update(tikisseReferrals).set({ status: "rewarded", rewardedAt: new Date(), rewardedByAdminId: input.adminId }).where(eq(tikisseReferrals.id, referral.id));
    // Même transaction que la mise à jour du statut : si le crédit échoue, le parrainage reste "qualified"
    // (rollback complet) plutôt que "rewarded" sans que l'argent n'ait jamais été crédité.
    await db.adminAdjustWallet({ profilePhone: referral.referrerPhone, amount: referral.rewardAmount, direction: "credit", operation: "bonus", reason: `Récompense de parrainage — filleul ${referral.refereePhone}`, idempotencyKey: `${referral.id}:admin-reward` }, tx);
    return { referralId: referral.id, status: "rewarded" as const };
  });
}

export async function adminGetReferralSettings() {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  await dbc.insert(tikissePlatformSettings).values({ id: 1 }).onConflictDoNothing();
  const settings = (await dbc.select().from(tikissePlatformSettings).where(eq(tikissePlatformSettings.id, 1)).limit(1))[0];
  return { rewardAmount: settings?.referralRewardAmount ?? 1000, enabled: settings?.referralEnabled ?? true, requiredDeliveries: settings?.referralRequiredDeliveries ?? 1 };
}

export async function adminUpdateReferralSettings(input: { rewardAmount: number; enabled: boolean; requiredDeliveries: number }) {
  if (!Number.isSafeInteger(input.rewardAmount) || input.rewardAmount < 0 || input.rewardAmount > 100_000) throw new Error("Montant de récompense invalide.");
  if (!Number.isSafeInteger(input.requiredDeliveries) || input.requiredDeliveries < 1 || input.requiredDeliveries > 100) throw new Error("Le nombre de courses requis doit être compris entre 1 et 100.");
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  await dbc.insert(tikissePlatformSettings).values({ id: 1, referralRewardAmount: input.rewardAmount, referralEnabled: input.enabled, referralRequiredDeliveries: input.requiredDeliveries }).onConflictDoUpdate({ target: tikissePlatformSettings.id, set: { referralRewardAmount: input.rewardAmount, referralEnabled: input.enabled, referralRequiredDeliveries: input.requiredDeliveries } });
  return input;
}

// ————————————————————————————————————————————————————————————————————————
// Gestion financière complète
// ————————————————————————————————————————————————————————————————————————

export async function adminGetFinanceSettings() {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  await dbc.insert(tikissePlatformSettings).values({ id: 1 }).onConflictDoNothing();
  const settings = (await dbc.select().from(tikissePlatformSettings).where(eq(tikissePlatformSettings.id, 1)).limit(1))[0];
  // Réutilise la même validation stricte que le taux appliqué en production (db.getTikisseCommissionRate) :
  // si la configuration est absente ou invalide, l'admin doit voir une erreur explicite plutôt qu'un
  // taux par défaut silencieux de 10 % qui masquerait un vrai problème de configuration.
  return {
    commissionRate: await db.getTikisseCommissionRate(),
    minWithdrawal: settings?.minWithdrawal ?? 500,
    maxWithdrawal: settings?.maxWithdrawal ?? 500000,
  };
}

export async function adminUpdateFinanceSettings(input: { minWithdrawal: number; maxWithdrawal: number }) {
  if (!Number.isSafeInteger(input.minWithdrawal) || input.minWithdrawal < 0) throw new Error("Montant minimum de retrait invalide.");
  if (!Number.isSafeInteger(input.maxWithdrawal) || input.maxWithdrawal <= input.minWithdrawal) throw new Error("Le montant maximum doit être supérieur au minimum.");
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  await dbc.insert(tikissePlatformSettings).values({ id: 1, minWithdrawal: input.minWithdrawal, maxWithdrawal: input.maxWithdrawal }).onConflictDoUpdate({ target: tikissePlatformSettings.id, set: { minWithdrawal: input.minWithdrawal, maxWithdrawal: input.maxWithdrawal } });
  return input;
}

export async function adminGetPaymentTransaction(id: string) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  return (await dbc.select().from(tikissePaymentTransactions).where(eq(tikissePaymentTransactions.id, id)).limit(1))[0];
}

export type PaymentTransactionStatus = "pending" | "succeeded" | "failed" | "cancelled" | "expired";

/**
 * Transactions de paiement, paginées, avec le total. `query` retrouve une transaction par numéro de téléphone
 * (préfixe, « +226 70… » ou « 70… »), par référence YengaPay ou de versement (exacte), ou par identifiant.
 */
export async function adminListPaymentTransactions(input: { type?: "deposit" | "withdrawal"; status?: PaymentTransactionStatus; query?: string; limit?: number; offset?: number }) {
  const dbc = await getDb();
  if (!dbc) return { rows: [] as (typeof tikissePaymentTransactions.$inferSelect)[], total: 0 };
  const query = input.query?.trim();
  const digits = query?.replace(/[^0-9]/g, "") ?? "";
  const conditions = [
    input.type ? eq(tikissePaymentTransactions.type, input.type) : undefined,
    input.status ? eq(tikissePaymentTransactions.status, input.status) : undefined,
    query ? or(
      eq(tikissePaymentTransactions.id, query),
      eq(tikissePaymentTransactions.providerReference, query),
      eq(tikissePaymentTransactions.payoutReference, query),
      ...(digits.length >= 4 ? [like(tikissePaymentTransactions.profilePhone, `+${digits}%`), like(tikissePaymentTransactions.profilePhone, `+226${digits}%`)] : []),
    ) : undefined,
  ].filter((value): value is NonNullable<typeof value> => Boolean(value));
  const where = conditions.length ? and(...conditions) : undefined;
  const limit = Math.min(input.limit ?? 50, 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const [rows, totalResult] = await Promise.all([
    dbc.select().from(tikissePaymentTransactions).where(where).orderBy(desc(tikissePaymentTransactions.createdAt)).limit(limit).offset(offset),
    dbc.select({ count: count() }).from(tikissePaymentTransactions).where(where),
  ]);
  return { rows, total: Number(totalResult[0]?.count ?? 0) };
}

// ————————————————————————————————————————————————————————————————————————
// Estimation intelligente des prix (paramètres par type d'engin)
// ————————————————————————————————————————————————————————————————————————

export type PricingConfig = {
  vehicles: Record<string, { minimum: number; perKm: number }>;
  typeAdjustment: { plis: number; personnePerPassenger: number };
  cargo: { base: number; perKg: number; perKgCap: number; perM3: number; perM3Cap: number };
};

const DEFAULT_PRICING_CONFIG: PricingConfig = {
  vehicles: {
    "Vélo": { minimum: 500, perKm: 115 },
    "Moto": { minimum: 750, perKm: 165 },
    "Tricycle": { minimum: 1100, perKm: 220 },
    "Voiture": { minimum: 1600, perKm: 290 },
  },
  typeAdjustment: { plis: 180, personnePerPassenger: 240 },
  cargo: { base: 280, perKg: 22, perKgCap: 1800, perM3: 5200, perM3Cap: 2600 },
};

export async function adminGetPricingConfig(): Promise<PricingConfig> {
  const dbc = await getDb();
  if (!dbc) return DEFAULT_PRICING_CONFIG;
  await dbc.insert(tikissePlatformSettings).values({ id: 1 }).onConflictDoNothing();
  const settings = (await dbc.select().from(tikissePlatformSettings).where(eq(tikissePlatformSettings.id, 1)).limit(1))[0];
  if (!settings?.pricingConfig) return DEFAULT_PRICING_CONFIG;
  try {
    const parsed = JSON.parse(settings.pricingConfig) as Partial<PricingConfig>;
    return { vehicles: { ...DEFAULT_PRICING_CONFIG.vehicles, ...parsed.vehicles }, typeAdjustment: { ...DEFAULT_PRICING_CONFIG.typeAdjustment, ...parsed.typeAdjustment }, cargo: { ...DEFAULT_PRICING_CONFIG.cargo, ...parsed.cargo } };
  } catch {
    return DEFAULT_PRICING_CONFIG;
  }
}

export async function adminUpdatePricingConfig(config: PricingConfig) {
  for (const [vehicle, rate] of Object.entries(config.vehicles)) {
    if (!Number.isFinite(rate.minimum) || rate.minimum < 0 || rate.minimum > 100_000) throw new Error(`Tarif minimum invalide pour ${vehicle}.`);
    if (!Number.isFinite(rate.perKm) || rate.perKm < 0 || rate.perKm > 10_000) throw new Error(`Tarif au kilomètre invalide pour ${vehicle}.`);
  }
  for (const [key, value] of Object.entries(config.cargo)) {
    if (!Number.isFinite(value) || value < 0 || value > 100_000) throw new Error(`Valeur invalide pour le paramètre poids/volume « ${key} ».`);
  }
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  const serialized = JSON.stringify(config);
  await dbc.insert(tikissePlatformSettings).values({ id: 1, pricingConfig: serialized }).onConflictDoUpdate({ target: tikissePlatformSettings.id, set: { pricingConfig: serialized } });
  return config;
}

// ————————————————————————————————————————————————————————————————————————
// Réglage des pays
// ————————————————————————————————————————————————————————————————————————

export async function adminListCountries() {
  const dbc = await getDb();
  if (!dbc) return [];
  const rows = await dbc.select().from(tikisseSupportedCountries);
  const accounts = await countryAccountCounts(dbc, rows);
  // `issue` rend visibles les lignes enregistrées avant que la cohérence soit
  // vérifiée : la console les signale au lieu de les laisser passer pour bonnes.
  return rows
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "fr"))
    .map((row) => ({
      ...row,
      accountCount: accounts.get(row.id) ?? 0,
      issue: countryDraftIssue({ id: row.id, name: row.name, dialCode: row.dialCode }),
      planWarning: countryPlanWarning({
        id: row.id, name: row.name, dialCode: row.dialCode,
        digits: row.digits, groups: row.groups.split(",").map(Number),
      }),
    }));
}

/**
 * Comptes rattachés à chaque pays : pays déclaré au profil, ou à défaut l'indicatif du numéro (les
 * profils créés avant la colonne `country` n'en ont pas). C'est ce qui interdit une suppression.
 */
async function countryAccountCounts(dbc: NonNullable<Awaited<ReturnType<typeof getDb>>>, countries: Array<{ id: string; dialCode: string }>) {
  const counts = new Map<string, number>();
  for (const country of countries) {
    const rows = await dbc.select({ count: count() }).from(tikisseProfiles).where(or(
      eq(tikisseProfiles.country, country.id),
      and(isNull(tikisseProfiles.country), like(tikisseProfiles.phone, `${country.dialCode}%`)),
    ));
    counts.set(country.id, Number(rows[0]?.count ?? 0));
  }
  return counts;
}

export async function adminUpsertCountry(input: { id: string; name: string; dialCode: string; digits: number; groups: number[]; timeZones: string[]; enabled: boolean; sortOrder?: number }) {
  if (!/^[A-Z]{2}$/.test(input.id)) throw new Error("Le code pays doit être un code ISO à 2 lettres (ex. BF).");
  if (!/^\+\d{1,4}$/.test(input.dialCode)) throw new Error("Indicatif téléphonique invalide (ex. +226).");
  // Le code, le nom et l'indicatif doivent désigner le même pays. Sans cette
  // vérification, « Bénin / BN / +229 » s'enregistrait sans broncher — et BN est
  // le Brunei, dont l'application affichait ensuite le drapeau et les villes.
  const inconsistency = countryDraftIssue({ id: input.id, name: input.name, dialCode: input.dialCode });
  if (inconsistency) throw new Error(inconsistency);
  if (!Number.isInteger(input.digits) || input.digits < 4 || input.digits > 15) throw new Error("Nombre de chiffres invalide.");
  if (input.groups.reduce((a, b) => a + b, 0) !== input.digits) throw new Error("La somme des groupes d’affichage doit être égale au nombre de chiffres.");
  if (input.timeZones.length === 0) throw new Error("Au moins un fuseau horaire est requis.");
  const invalidZone = input.timeZones.find((zone) => !isValidTimeZone(zone));
  if (invalidZone) throw new Error(`Fuseau horaire inconnu : ${invalidZone} (ex. Africa/Ouagadougou).`);
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  // Un nouveau pays se range à la fin de la liste ; une modification garde sa place.
  const existing = (await dbc.select().from(tikisseSupportedCountries).where(eq(tikisseSupportedCountries.id, input.id)).limit(1))[0];
  const last = (await dbc.select({ max: sql<number>`coalesce(max(${tikisseSupportedCountries.sortOrder}), 0)`.mapWith(Number) }).from(tikisseSupportedCountries))[0]?.max ?? 0;
  const values = {
    id: input.id, name: input.name.trim(), dialCode: input.dialCode, digits: input.digits,
    groups: input.groups.join(","), timeZones: input.timeZones.join(","), enabled: input.enabled,
    sortOrder: input.sortOrder ?? existing?.sortOrder ?? Number(last) + 1,
  };
  await dbc.insert(tikisseSupportedCountries).values(values).onConflictDoUpdate({ target: tikisseSupportedCountries.id, set: values });
  return values;
}

export async function adminSetCountryEnabled(id: string, enabled: boolean) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  const country = (await dbc.select().from(tikisseSupportedCountries).where(eq(tikisseSupportedCountries.id, id)).limit(1))[0];
  if (!country) throw new Error("Pays introuvable.");
  if (!enabled) {
    const remainingEnabled = await dbc.select({ count: count() }).from(tikisseSupportedCountries).where(and(eq(tikisseSupportedCountries.enabled, true), sql`${tikisseSupportedCountries.id} != ${id}`));
    if (Number(remainingEnabled[0]?.count ?? 0) === 0) throw new Error("Impossible de désactiver le dernier pays actif.");
  }
  await dbc.update(tikisseSupportedCountries).set({ enabled }).where(eq(tikisseSupportedCountries.id, id));
  return { id, enabled };
}

/**
 * Supprime un pays de la liste. Refusé tant que des comptes y sont rattachés : leurs numéros ne se
 * reconnaîtraient plus à la connexion. Pour ceux-là, la désactivation ferme les nouvelles inscriptions
 * sans rien casser.
 */
export async function adminDeleteCountry(id: string) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  const country = (await dbc.select().from(tikisseSupportedCountries).where(eq(tikisseSupportedCountries.id, id)).limit(1))[0];
  if (!country) throw new Error("Pays introuvable.");
  if (country.enabled) {
    const remainingEnabled = await dbc.select({ count: count() }).from(tikisseSupportedCountries).where(and(eq(tikisseSupportedCountries.enabled, true), sql`${tikisseSupportedCountries.id} != ${id}`));
    if (Number(remainingEnabled[0]?.count ?? 0) === 0) throw new Error("Impossible de supprimer le dernier pays actif.");
  }
  const accounts = (await countryAccountCounts(dbc, [country])).get(id) ?? 0;
  if (accounts > 0) {
    throw new Error(`${country.name} compte ${accounts} compte${accounts > 1 ? "s" : ""} inscrit${accounts > 1 ? "s" : ""} : il ne peut pas être supprimé. Désactivez-le pour fermer les nouvelles inscriptions.`);
  }
  await dbc.delete(tikisseSupportedCountries).where(eq(tikisseSupportedCountries.id, id));
  return country;
}

/** Enregistre l'ordre d'affichage (liste d'inscription de l'application). `ids` : tous les pays, dans l'ordre voulu. */
export async function adminReorderCountries(ids: string[]) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  const current = (await dbc.select({ id: tikisseSupportedCountries.id }).from(tikisseSupportedCountries)).map((row) => row.id);
  if (ids.length !== current.length || new Set(ids).size !== ids.length || ids.some((id) => !current.includes(id))) {
    throw new Error("La liste des pays a changé entre-temps. Rechargez la page.");
  }
  await dbc.transaction(async (tx) => {
    for (const [index, id] of ids.entries()) await tx.update(tikisseSupportedCountries).set({ sortOrder: index + 1 }).where(eq(tikisseSupportedCountries.id, id));
  });
  return { ids };
}

function isValidTimeZone(zone: string) {
  try {
    new Intl.DateTimeFormat("fr-FR", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// ————————————————————————————————————————————————————————————————————————
// Mode maintenance
// ————————————————————————————————————————————————————————————————————————

export async function adminSetMaintenance(input: { enabled: boolean; message?: string }) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  await dbc.insert(tikissePlatformSettings).values({ id: 1, maintenanceEnabled: input.enabled, maintenanceMessage: input.message?.trim() || null }).onConflictDoUpdate({ target: tikissePlatformSettings.id, set: { maintenanceEnabled: input.enabled, maintenanceMessage: input.message?.trim() || null } });
  return { enabled: input.enabled, message: input.message?.trim() || undefined };
}

// ————————————————————————————————————————————————————————————————————————
// Suppression de compte — vue administrateur
// ————————————————————————————————————————————————————————————————————————


// ————————————————————————————————————————————————————————————————————————
// Vérification d'identité (KYC)
// ————————————————————————————————————————————————————————————————————————

export async function adminListKycSubmissions(status?: "submitted" | "approved" | "rejected") {
  const dbc = await getDb();
  if (!dbc) return [];
  const base = dbc.select({
    submission: tikisseKycSubmissions,
    driverName: tikisseProfiles.fullName,
  }).from(tikisseKycSubmissions).innerJoin(tikisseProfiles, eq(tikisseKycSubmissions.driverPhone, tikisseProfiles.phone));
  const filtered = status ? base.where(eq(tikisseKycSubmissions.status, status)) : base;
  return filtered.orderBy(desc(tikisseKycSubmissions.submittedAt));
}

/**
 * Décision sur un dossier d'identité, sous verrou : un dossier se tranche une seule fois. Avant, deux admins
 * pouvaient statuer en même temps sans le voir, et un dossier déjà approuvé pouvait être refusé après coup
 * (ou l'inverse) sans que le livreur en sache rien. Le livreur est désormais prévenu de la décision.
 */
export async function adminReviewKyc(input: { submissionId: string; decision: "approved" | "rejected"; rejectionReason?: string; adminId: number }) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  const rejectionReason = input.decision === "rejected" ? (input.rejectionReason?.trim() || "Documents non conformes.") : null;
  const driverPhone = await dbc.transaction(async (tx) => {
    const submission = (await tx.select().from(tikisseKycSubmissions).where(eq(tikisseKycSubmissions.id, input.submissionId)).limit(1).for("update"))[0];
    if (!submission) throw new Error("Dossier introuvable.");
    if (submission.status !== "submitted") throw new Error(`Ce dossier a déjà été ${submission.status === "approved" ? "approuvé" : "refusé"}. Le livreur doit en soumettre un nouveau pour une nouvelle décision.`);
    await tx.update(tikisseKycSubmissions).set({ status: input.decision, rejectionReason, reviewedAt: new Date(), reviewedByAdminId: input.adminId }).where(eq(tikisseKycSubmissions.id, input.submissionId));
    return submission.driverPhone;
  });
  // Pas de livraison à laquelle rattacher une notification in-app : un push, et l'écran « Vérification »
  // de l'app affiche déjà le statut et le motif du refus. Best-effort : la décision est enregistrée.
  void db.enqueuePushToPhone({
    phone: driverPhone,
    title: input.decision === "approved" ? "Identité vérifiée" : "Vérification d’identité refusée",
    body: input.decision === "approved" ? "Vos documents sont validés : vous pouvez candidater aux livraisons." : `Motif : ${rejectionReason} Vous pouvez soumettre de nouveaux documents.`,
    data: { kind: "kyc_decision", screen: "verification" },
    channelId: "tikisse-transactional",
  }).catch((cause) => console.error("[kyc] notification non envoyée", cause));
  return { id: input.submissionId, status: input.decision, driverPhone };
}

// ————————————————————————————————————————————————————————————————————————
// Programme de fidélité
// ————————————————————————————————————————————————————————————————————————

export async function adminListLoyaltyPrograms() {
  const dbc = await getDb();
  if (!dbc) return [];
  return dbc.select().from(tikisseLoyaltyPrograms).orderBy(desc(tikisseLoyaltyPrograms.updatedAt));
}

export async function adminUpsertLoyaltyProgram(input: {
  id?: string;
  name: string;
  description?: string;
  role: "sender" | "driver";
  requiredDeliveries: number;
  bonusAmount: number;
  windowDays: number;
  autoCredit?: boolean;
  autoCreditMaxAmount?: number;
  enabled: boolean;
  adminId: number;
}) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  const { randomUUID } = await import("node:crypto");
  const id = input.id ?? `prog-${randomUUID().slice(0, 12)}`;
  const autoCredit = input.autoCredit ?? false;
  const autoCreditMaxAmount = input.autoCreditMaxAmount ?? 0;
  await dbc.insert(tikisseLoyaltyPrograms).values({
    id,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    role: input.role,
    requiredDeliveries: input.requiredDeliveries,
    bonusAmount: input.bonusAmount,
    windowDays: input.windowDays,
    autoCredit,
    autoCreditMaxAmount,
    enabled: input.enabled,
  }).onConflictDoUpdate({ target: tikisseLoyaltyPrograms.id,
    set: {
      name: input.name.trim(),
      description: input.description?.trim() || null,
      role: input.role,
      requiredDeliveries: input.requiredDeliveries,
      bonusAmount: input.bonusAmount,
      windowDays: input.windowDays,
      autoCredit,
      autoCreditMaxAmount,
      enabled: input.enabled,
    },
  });
  const row = (await dbc.select().from(tikisseLoyaltyPrograms).where(eq(tikisseLoyaltyPrograms.id, id)).limit(1))[0];
  return row;
}

export async function adminSetLoyaltyProgramEnabled(input: { id: string; enabled: boolean }) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  await dbc.update(tikisseLoyaltyPrograms).set({ enabled: input.enabled }).where(eq(tikisseLoyaltyPrograms.id, input.id));
}

export async function adminListPendingLoyaltyGrants(limit: number) {
  const dbc = await getDb();
  if (!dbc) return [];
  const rows = await dbc.select().from(tikisseLoyaltyGrants).where(eq(tikisseLoyaltyGrants.status, "pending")).orderBy(desc(tikisseLoyaltyGrants.grantedAt)).limit(Math.min(limit, 200));
  return rows;
}

export async function adminCreditLoyaltyGrant(input: { grantId: string; adminId: number }) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  const { creditLoyaltyGrantOnWallet } = await import("./loyalty");
  const result = await creditLoyaltyGrantOnWallet(input.grantId);
  if (!result.credited) {
    const existing = (await dbc.select().from(tikisseLoyaltyGrants).where(eq(tikisseLoyaltyGrants.id, input.grantId)).limit(1))[0];
    if (existing && existing.status !== "pending") throw new Error("Cet octroi a déjà été traité.");
    throw new Error("Cet octroi a déjà été traité.");
  }
  const grant = (await dbc.select().from(tikisseLoyaltyGrants).where(eq(tikisseLoyaltyGrants.id, input.grantId)).limit(1))[0];
  return { id: input.grantId, profilePhone: grant?.profilePhone ?? "", bonusAmount: grant?.bonusAmount ?? 0, wallet: result.wallet };
}

export async function adminCancelLoyaltyGrant(input: { grantId: string; reason: string; adminId: number }) {
  const dbc = await getDb();
  if (!dbc) throw new Error("La console d’administration est temporairement indisponible.");
  await dbc.update(tikisseLoyaltyGrants).set({ status: "cancelled" }).where(and(eq(tikisseLoyaltyGrants.id, input.grantId), eq(tikisseLoyaltyGrants.status, "pending")));
}
