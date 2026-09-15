/**
 * Gestion des sessions multi-device.
 *
 * - On ne stocke JAMAIS le token JWT complet en base (security best practice).
 * - On stocke un hash SHA-256 (pour identifier la session) + les 4 derniers
 *   caractères (pour affichage type "...7F2A").
 * - À chaque requête, on "touche" la session (lastSeenAt) pour la garder active.
 * - L'utilisateur peut lister ses sessions et révoquer celles qu'il ne reconnaît pas.
 */

import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { getDb } from "./db";
import { tikisProfileSessions } from "../drizzle/schema";
import { hashSessionToken, tokenLast4 } from "./_test-helpers/sessions-hash";

const ACTIVE_SESSION_WINDOW_DAYS = 30;

export { hashSessionToken, tokenLast4 };

export type Platform = "ios" | "android" | "web" | "unknown";

export type SessionInput = {
  phone: string;
  token: string;
  deviceName?: string;
  platform?: Platform;
  appVersion?: string;
  ipAddress?: string;
};

export function isMissingProfileSessionsSchema(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = candidate?.cause?.code ?? candidate?.code;
  const message = candidate?.cause?.message ?? candidate?.message ?? "";
  return code === "ER_NO_SUCH_TABLE" || (message.includes("tikis_profile_sessions") && message.includes("doesn't exist"));
}

/** Upsert idempotent d'une session : si (phone, tokenHash) existe, on met à jour
 *  lastSeenAt + métadonnées. Sinon on crée. */
export async function recordSession(input: SessionInput) {
  const db = await getDb();
  if (!db) return null;
  const tokenHash = hashSessionToken(input.token);
  const last4 = tokenLast4(input.token);
  const now = new Date();
  const existing = (await db.select().from(tikisProfileSessions).where(and(eq(tikisProfileSessions.phone, input.phone), eq(tikisProfileSessions.tokenHash, tokenHash))).limit(1))[0];
  if (existing) {
    await db.update(tikisProfileSessions).set({
      lastSeenAt: now,
      deviceName: input.deviceName ?? existing.deviceName,
      platform: input.platform ?? existing.platform,
      appVersion: input.appVersion ?? existing.appVersion,
      ipAddress: input.ipAddress ?? existing.ipAddress,
      revokedAt: null,
    }).where(eq(tikisProfileSessions.id, existing.id));
    return { id: existing.id, created: false };
  }
  const id = randomUUID();
  await db.insert(tikisProfileSessions).values({
    id,
    phone: input.phone,
    tokenHash,
    tokenLast4: last4,
    deviceName: input.deviceName ?? null,
    platform: input.platform ?? "unknown",
    appVersion: input.appVersion ?? null,
    ipAddress: input.ipAddress ?? null,
    lastSeenAt: now,
  });
  return { id, created: true };
}

/** Liste les sessions actives d'un user, avec flag isCurrent. */
export async function listActiveSessions(input: { phone: string; currentTokenHash: string }) {
  const db = await getDb();
  if (!db) return [];
  const cutoff = new Date(Date.now() - ACTIVE_SESSION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(tikisProfileSessions)
    .where(and(
      eq(tikisProfileSessions.phone, input.phone),
      isNull(tikisProfileSessions.revokedAt),
      gte(tikisProfileSessions.lastSeenAt, cutoff),
    ))
    .orderBy(desc(tikisProfileSessions.lastSeenAt))
    .limit(20);
  return rows.map((row) => ({
    id: row.id,
    tokenLast4: row.tokenLast4,
    deviceName: row.deviceName,
    platform: row.platform,
    appVersion: row.appVersion,
    ipAddress: row.ipAddress,
    lastSeenAt: row.lastSeenAt instanceof Date ? row.lastSeenAt.toISOString() : String(row.lastSeenAt),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    isCurrent: row.tokenHash === input.currentTokenHash,
  }));
}

/** Révoque une session par id. Retourne le phone pour invalidation côté caller. */
export async function revokeSession(input: { phone: string; sessionId: string; currentTokenHash: string }) {
  const db = await getDb();
  if (!db) throw new Error("Les sessions sont temporairement indisponibles.");
  return db.transaction(async (tx) => {
    const session = (await tx.select().from(tikisProfileSessions).where(and(eq(tikisProfileSessions.id, input.sessionId), eq(tikisProfileSessions.phone, input.phone))).limit(1).for("update"))[0];
    if (!session) throw new Error("Session introuvable.");
    if (session.tokenHash === input.currentTokenHash) throw new Error("Tu ne peux pas révoquer ta propre session depuis cette liste. Utilise 'Déconnecter' pour fermer la session actuelle.");
    if (session.revokedAt) return { id: session.id, alreadyRevoked: true };
    await tx.update(tikisProfileSessions).set({ revokedAt: new Date() }).where(eq(tikisProfileSessions.id, session.id));
    return { id: session.id, alreadyRevoked: false };
  });
}

/** Révoque toutes les sessions sauf la courante. */
export async function revokeAllOtherSessions(input: { phone: string; currentTokenHash: string }) {
  const db = await getDb();
  if (!db) throw new Error("Les sessions sont temporairement indisponibles.");
  const result = await db
    .update(tikisProfileSessions)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(tikisProfileSessions.phone, input.phone),
      isNull(tikisProfileSessions.revokedAt),
      sql`${tikisProfileSessions.tokenHash} != ${input.currentTokenHash}`,
    ));
  return { revoked: (result as unknown as { affectedRows?: number }).affectedRows ?? 0 };
}

/** Vérifie qu'un token donné n'est pas révoqué. Utilisé par le middleware
 *  d'authentification pour rejeter un JWT dont la session a été déconnectée
 *  depuis un autre device. */
export async function isSessionRevoked(input: { phone: string; token: string }): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    const tokenHash = hashSessionToken(input.token);
    const row = (await db.select({ revokedAt: tikisProfileSessions.revokedAt }).from(tikisProfileSessions).where(and(eq(tikisProfileSessions.phone, input.phone), eq(tikisProfileSessions.tokenHash, tokenHash))).limit(1))[0];
    return Boolean(row?.revokedAt);
  } catch (error) {
    if (isMissingProfileSessionsSchema(error)) {
      console.error("[sessions] Table de révocation absente : migration 0030 à appliquer. Vérification temporairement ignorée.");
      return false;
    }
    throw error;
  }
}
