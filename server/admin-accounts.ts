/**
 * Comptes de la console d'administration gérés depuis la console elle-même : création avec mot de passe
 * provisoire, changement de rôle, réinitialisation du mot de passe, changement de son propre mot de passe,
 * sessions ouvertes, codes de secours de la double authentification.
 *
 * Jusqu'ici, créer un compte ou changer un mot de passe passait par un script exécuté sur le serveur.
 */
import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import { tikisseAdminSessions, tikisseAdminUsers } from "../drizzle/schema";
import { ADMIN_ROLES, type AdminRole } from "../shared/admin-roles";
import { hashAdminPassword, verifyAdminPassword } from "./admin-auth";
import { consumeSecondFactor, getAdminByEmail, revokeAllAdminSessions } from "./admin-db";
import { generateRecoveryCodes, hashRecoveryCode } from "./admin-totp";
import { getDb } from "./db";

export const ADMIN_PASSWORD_MIN_LENGTH = 12;

/**
 * Mot de passe provisoire lisible, transmis de vive voix ou par un canal sûr : 4 groupes de 4 caractères
 * sans ambiguïté (ni 0/O ni 1/l), environ 80 bits d'aléa. Il ne sert qu'une fois : le titulaire doit le
 * remplacer avant d'accéder à la console.
 */
export function temporaryAdminPassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(16);
  const chars = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]);
  return [0, 4, 8, 12].map((start) => chars.slice(start, start + 4).join("")).join("-");
}

async function database() {
  const db = await getDb();
  if (!db) throw new Error("La console d’administration est temporairement indisponible.");
  return db;
}

async function assertAnotherActiveSuperAdmin(tx: any, excludedAdminId: number) {
  const others = await tx.select({ id: tikisseAdminUsers.id }).from(tikisseAdminUsers)
    .where(and(eq(tikisseAdminUsers.role, "super_admin"), eq(tikisseAdminUsers.active, true), ne(tikisseAdminUsers.id, excludedAdminId))).for("update");
  if (others.length === 0) throw new Error("Impossible : ce compte est le dernier super-admin actif.");
}

export async function createAdminAccount(input: { email: string; fullName: string; role: AdminRole }) {
  if (!(ADMIN_ROLES as readonly string[]).includes(input.role)) throw new Error("Rôle inconnu.");
  const email = input.email.trim().toLowerCase();
  if (await getAdminByEmail(email)) throw new Error("Un compte admin existe déjà pour cet email.");
  const temporaryPassword = temporaryAdminPassword();
  const db = await database();
  await db.insert(tikisseAdminUsers).values({ email, fullName: input.fullName.trim(), role: input.role, passwordHash: await hashAdminPassword(temporaryPassword), mustChangePassword: true });
  const created = await getAdminByEmail(email);
  return { adminId: created!.id, email, temporaryPassword };
}

/**
 * Changer le rôle d'un autre compte. Jamais le sien (un super-admin qui se rétrograde perd la main), et
 * jamais celui du dernier super-admin actif. Le nouveau rôle s'applique à la requête suivante : la session
 * relit le compte à chaque requête.
 */
export async function changeAdminRole(input: { actorAdminId: number; adminId: number; role: AdminRole }) {
  if (!(ADMIN_ROLES as readonly string[]).includes(input.role)) throw new Error("Rôle inconnu.");
  if (input.actorAdminId === input.adminId) throw new Error("Vous ne pouvez pas changer votre propre rôle.");
  const db = await database();
  return db.transaction(async (tx) => {
    const target = (await tx.select().from(tikisseAdminUsers).where(eq(tikisseAdminUsers.id, input.adminId)).limit(1).for("update"))[0];
    if (!target) throw new Error("Compte admin introuvable.");
    if (target.role === "super_admin" && input.role !== "super_admin" && target.active) await assertAnotherActiveSuperAdmin(tx, target.id);
    await tx.update(tikisseAdminUsers).set({ role: input.role }).where(eq(tikisseAdminUsers.id, input.adminId));
    return { before: target.role, after: input.role };
  });
}

/** Mot de passe oublié : un super-admin en génère un provisoire. Les sessions ouvertes du compte tombent. */
export async function resetAdminPassword(input: { actorAdminId: number; adminId: number }) {
  if (input.actorAdminId === input.adminId) throw new Error("Pour votre propre compte, changez votre mot de passe depuis « Mon compte ».");
  const db = await database();
  const temporaryPassword = temporaryAdminPassword();
  const passwordHash = await hashAdminPassword(temporaryPassword);
  await db.transaction(async (tx) => {
    const target = (await tx.select({ id: tikisseAdminUsers.id }).from(tikisseAdminUsers).where(eq(tikisseAdminUsers.id, input.adminId)).limit(1).for("update"))[0];
    if (!target) throw new Error("Compte admin introuvable.");
    await tx.update(tikisseAdminUsers).set({ passwordHash, mustChangePassword: true }).where(eq(tikisseAdminUsers.id, input.adminId));
    await revokeAllAdminSessions(input.adminId, tx);
  });
  return { temporaryPassword };
}

/**
 * Changer son propre mot de passe, avec l'actuel (provisoire ou non). Les autres sessions du compte
 * tombent ; celle en cours reste ouverte.
 */
export async function changeOwnAdminPassword(input: { adminId: number; sessionId: string | undefined; currentPassword: string; newPassword: string }) {
  if (input.newPassword.length < ADMIN_PASSWORD_MIN_LENGTH) throw new Error(`Le mot de passe doit contenir au moins ${ADMIN_PASSWORD_MIN_LENGTH} caractères.`);
  if (input.newPassword === input.currentPassword) throw new Error("Le nouveau mot de passe doit être différent de l’actuel.");
  const db = await database();
  const account = (await db.select().from(tikisseAdminUsers).where(eq(tikisseAdminUsers.id, input.adminId)).limit(1))[0];
  if (!account) throw new Error("Compte admin introuvable.");
  if (!(await verifyAdminPassword(input.currentPassword, account.passwordHash))) throw new Error("Mot de passe actuel incorrect.");
  const passwordHash = await hashAdminPassword(input.newPassword);
  await db.transaction(async (tx) => {
    await tx.update(tikisseAdminUsers).set({ passwordHash, mustChangePassword: false }).where(eq(tikisseAdminUsers.id, input.adminId));
    await tx.update(tikisseAdminSessions).set({ revokedAt: new Date() }).where(and(
      eq(tikisseAdminSessions.adminId, input.adminId), isNull(tikisseAdminSessions.revokedAt),
      ...(input.sessionId ? [ne(tikisseAdminSessions.id, input.sessionId)] : []),
    ));
  });
}

/** Sessions ouvertes (actives, ni révoquées ni expirées), les plus récemment utilisées d'abord. */
export async function listAdminSessions(adminId: number) {
  const db = await database();
  return db.select({
    id: tikisseAdminSessions.id, ipAddress: tikisseAdminSessions.ipAddress, userAgent: tikisseAdminSessions.userAgent,
    createdAt: tikisseAdminSessions.createdAt, lastSeenAt: tikisseAdminSessions.lastSeenAt, expiresAt: tikisseAdminSessions.expiresAt,
  }).from(tikisseAdminSessions)
    .where(and(eq(tikisseAdminSessions.adminId, adminId), eq(tikisseAdminSessions.stage, "active"), isNull(tikisseAdminSessions.revokedAt), gt(tikisseAdminSessions.expiresAt, new Date())))
    .orderBy(desc(tikisseAdminSessions.lastSeenAt));
}

/** Ferme une session. `ownerAdminId` limite la révocation aux sessions de ce compte (révocation de ses propres sessions). */
export async function revokeAdminSessionById(input: { sessionId: string; ownerAdminId?: number }) {
  const db = await database();
  const session = (await db.select({ id: tikisseAdminSessions.id, adminId: tikisseAdminSessions.adminId }).from(tikisseAdminSessions).where(eq(tikisseAdminSessions.id, input.sessionId)).limit(1))[0];
  if (!session || (input.ownerAdminId !== undefined && session.adminId !== input.ownerAdminId)) throw new Error("Session introuvable.");
  await db.update(tikisseAdminSessions).set({ revokedAt: new Date() }).where(and(eq(tikisseAdminSessions.id, input.sessionId), isNull(tikisseAdminSessions.revokedAt)));
  return { adminId: session.adminId };
}

/**
 * Nouveaux codes de secours, contre un code valide (application ou code de secours restant). Les anciens
 * cessent aussitôt de fonctionner. Rendus en clair cette seule fois.
 */
export async function regenerateRecoveryCodes(input: { adminId: number; code: string }) {
  const db = await database();
  return db.transaction(async (tx) => {
    const factor = await consumeSecondFactor(tx, input.adminId, input.code);
    if (!factor) throw new Error("Code invalide.");
    const recoveryCodes = generateRecoveryCodes();
    await tx.update(tikisseAdminUsers).set({ totpRecoveryCodes: JSON.stringify(recoveryCodes.map(hashRecoveryCode)) }).where(eq(tikisseAdminUsers.id, input.adminId));
    return { recoveryCodes };
  });
}
