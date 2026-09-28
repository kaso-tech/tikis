/**
 * Outils de support sur une fiche utilisateur : appareils connectés et déconnexion forcée, notes internes,
 * historique des décisions de l'équipe, levée des limites anti-abus.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, like, ne, or } from "drizzle-orm";
import { tikisseAdminAuditLog, tikisseProfileNotes, tikisseProfileSessions, tikisseProfiles, tikissePushTokens, tikisseRateLimits } from "../drizzle/schema";
import * as db from "./db";

const PHONE = /^\+[1-9]\d{7,14}$/;

async function database() {
  const handle = await db.getDb();
  if (!handle) throw new Error("La console d’administration est temporairement indisponible.");
  return handle;
}

async function existingProfile(phone: string) {
  const profile = await db.getTikisseProfileByPhone(phone);
  if (!profile) throw new Error("Profil introuvable.");
  return profile;
}

// ————————————————————————————————————————————————————————————————————————
// Appareils et déconnexion forcée
// ————————————————————————————————————————————————————————————————————————

/** Sessions enregistrées par l'application (les plus récentes d'abord) et appareils qui reçoivent les notifications. */
export async function listUserDevices(phone: string) {
  const profile = await existingProfile(phone);
  const handle = await database();
  const [sessions, pushTokens] = await Promise.all([
    handle.select({
      id: tikisseProfileSessions.id, deviceName: tikisseProfileSessions.deviceName, platform: tikisseProfileSessions.platform, appVersion: tikisseProfileSessions.appVersion,
      ipAddress: tikisseProfileSessions.ipAddress, tokenLast4: tikisseProfileSessions.tokenLast4, createdAt: tikisseProfileSessions.createdAt, lastSeenAt: tikisseProfileSessions.lastSeenAt, revokedAt: tikisseProfileSessions.revokedAt,
    }).from(tikisseProfileSessions).where(eq(tikisseProfileSessions.phone, phone)).orderBy(desc(tikisseProfileSessions.lastSeenAt)).limit(30),
    handle.select({ id: tikissePushTokens.id, platform: tikissePushTokens.platform, deviceName: tikissePushTokens.deviceName, appVersion: tikissePushTokens.appVersion, lastSeenAt: tikissePushTokens.lastSeenAt })
      .from(tikissePushTokens).where(eq(tikissePushTokens.phone, phone)).orderBy(desc(tikissePushTokens.lastSeenAt)).limit(30),
  ]);
  return { sessionsRevokedAt: profile.sessionsRevokedAt, sessions: sessions.map((session) => ({ ...session, active: !session.revokedAt })), pushTokens };
}

/**
 * Déconnecte l'utilisateur de tous ses appareils : tout jeton émis jusqu'ici est refusé (qu'il ait été
 * enregistré comme appareil ou non), les sessions enregistrées sont marquées révoquées, et les appareils
 * ne reçoivent plus ses notifications jusqu'à la prochaine connexion.
 */
export async function forceLogout(phone: string) {
  await existingProfile(phone);
  const handle = await database();
  const now = new Date();
  return handle.transaction(async (tx) => {
    await tx.update(tikisseProfiles).set({ sessionsRevokedAt: now, updatedAt: now }).where(eq(tikisseProfiles.phone, phone));
    const sessions = await tx.update(tikisseProfileSessions).set({ revokedAt: now }).where(and(eq(tikisseProfileSessions.phone, phone), isNull(tikisseProfileSessions.revokedAt)));
    const tokens = await tx.delete(tikissePushTokens).where(eq(tikissePushTokens.phone, phone));
    return {
      revokedSessions: (sessions as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0,
      removedPushTokens: (tokens as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0,
      at: now,
    };
  });
}

/** Déconnecte un seul appareil enregistré (l'application envoie son jeton en en-tête, vérifié à chaque requête). */
export async function revokeUserSession(phone: string, sessionId: string) {
  const handle = await database();
  const session = (await handle.select().from(tikisseProfileSessions).where(and(eq(tikisseProfileSessions.id, sessionId), eq(tikisseProfileSessions.phone, phone))).limit(1))[0];
  if (!session) throw new Error("Appareil introuvable.");
  if (session.revokedAt) return { alreadyRevoked: true, deviceName: session.deviceName };
  await handle.update(tikisseProfileSessions).set({ revokedAt: new Date() }).where(eq(tikisseProfileSessions.id, sessionId));
  return { alreadyRevoked: false, deviceName: session.deviceName };
}

// ————————————————————————————————————————————————————————————————————————
// Notes internes et historique
// ————————————————————————————————————————————————————————————————————————

export const NOTE_MAX_LENGTH = 1000;

/** Note du support, jamais montrée à l'utilisateur. Non modifiable : on ajoute une nouvelle note pour corriger. */
export async function addProfileNote(input: { phone: string; body: string; adminId: number; adminEmail: string }) {
  const body = input.body.trim();
  if (body.length < 2) throw new Error("La note est vide.");
  if (body.length > NOTE_MAX_LENGTH) throw new Error(`Une note fait au plus ${NOTE_MAX_LENGTH} caractères.`);
  await existingProfile(input.phone);
  const handle = await database();
  const id = randomUUID();
  await handle.insert(tikisseProfileNotes).values({ id, profilePhone: input.phone, body, adminId: input.adminId, adminEmail: input.adminEmail });
  return { id };
}

export async function listProfileNotes(phone: string) {
  const handle = await database();
  return handle.select().from(tikisseProfileNotes).where(eq(tikisseProfileNotes.profilePhone, phone)).orderBy(desc(tikisseProfileNotes.createdAt)).limit(200);
}

/** Actions consignées au journal d'audit qui ont modifié ce compte (statut, rôle, argent, sessions…). */
const HISTORY_EXCLUDED_ACTIONS = ["profile_viewed", "profile_note_added"];

export async function profileHistory(phone: string) {
  const handle = await database();
  return handle.select({
    id: tikisseAdminAuditLog.id, action: tikisseAdminAuditLog.action, adminEmail: tikisseAdminAuditLog.adminEmail, details: tikisseAdminAuditLog.details, createdAt: tikisseAdminAuditLog.createdAt,
  }).from(tikisseAdminAuditLog)
    .where(and(eq(tikisseAdminAuditLog.targetType, "profile"), eq(tikisseAdminAuditLog.targetId, phone), ...HISTORY_EXCLUDED_ACTIONS.map((action) => ne(tikisseAdminAuditLog.action, action))))
    .orderBy(desc(tikisseAdminAuditLog.createdAt)).limit(200);
}

// ————————————————————————————————————————————————————————————————————————
// Limites anti-abus
// ————————————————————————————————————————————————————————————————————————

const SCOPE_LABELS: Record<string, string> = {
  lookup: "Connexion", lookupSupabase: "Connexion", register: "Inscription", registerSupabase: "Inscription", update: "Modification du profil",
  requestContactOtp: "Code de vérification", updateContact: "Changement de coordonnées", geo: "Recherche de lieux",
  "payment:request": "Demandes de paiement", "payment:resendOtp": "Renvoi du code de paiement", "payment:submitOtp": "Saisie du code de paiement", "payment:checkout": "Paiement",
};

function describeLimit(key: string, phone: string) {
  if (key.startsWith("phone-block:")) {
    const scope = key.slice("phone-block:".length, -(phone.length + 1));
    return { kind: "block" as const, scope, label: SCOPE_LABELS[scope] ?? scope };
  }
  const prefix = key.slice(0, key.indexOf(`:${phone}:`));
  const scope = prefix.startsWith("phone:") ? prefix.slice("phone:".length) : prefix;
  return { kind: "counter" as const, scope, label: SCOPE_LABELS[scope] ?? scope };
}

function limitKeysFor(phone: string) {
  if (!PHONE.test(phone)) throw new Error("Numéro invalide.");
  return or(like(tikisseRateLimits.rateLimitKey, `%:${phone}:%`), like(tikisseRateLimits.rateLimitKey, `phone-block:%:${phone}`));
}

/** Blocages en cours et compteurs récents (dernière heure) de ce numéro. */
export async function listRateLimits(phone: string) {
  const handle = await database();
  const since = new Date(Date.now() - 60 * 60_000);
  const nowMinute = Math.floor(Date.now() / 60_000);
  // Un blocage garde sa date de pose : on le montre tant qu'il court, quel que soit son âge.
  const rows = await handle.select().from(tikisseRateLimits).where(and(limitKeysFor(phone), or(gte(tikisseRateLimits.updatedAt, since), like(tikisseRateLimits.rateLimitKey, "phone-block:%"))));
  return rows.map((row) => {
    const description = describeLimit(row.rateLimitKey, phone);
    return description.kind === "block"
      ? { key: row.rateLimitKey, ...description, blockedForMinutes: Math.max(0, row.count - nowMinute), attempts: null, updatedAt: row.updatedAt }
      : { key: row.rateLimitKey, ...description, blockedForMinutes: null, attempts: row.count, updatedAt: row.updatedAt };
  }).filter((row) => row.kind === "counter" || (row.blockedForMinutes ?? 0) > 0);
}

/** Lève les blocages et remet à zéro les compteurs de ce numéro (ex. : l'utilisateur s'est trompé de code). */
export async function clearRateLimits(phone: string) {
  const handle = await database();
  const keys = (await handle.select({ key: tikisseRateLimits.rateLimitKey }).from(tikisseRateLimits).where(limitKeysFor(phone))).map((row) => row.key);
  if (keys.length) await handle.delete(tikisseRateLimits).where(inArray(tikisseRateLimits.rateLimitKey, keys));
  return { cleared: keys.length };
}
