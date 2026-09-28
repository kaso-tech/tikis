import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { isRevokedByProfile, verifyTikisseProfileSessionClaims } from "../tikisse-session";
import { getCachedTikisseProfile } from "./profile-cache";
import { ADMIN_CONSOLE_HEADER, ADMIN_SESSION_COOKIE, LEGACY_ADMIN_SESSION_COOKIE, type AdminRole } from "../admin-auth";
import { authenticateAdminSession } from "../admin-db";
import { LEGACY_TIKIS_PROFILE_COOKIE, TIKISSE_PROFILE_COOKIE } from "./cookies";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  tikisseProfilePhone: string | null;
  tikisseAdmin?: { adminId: number; email: string; role: AdminRole; totpEnabled?: boolean; mustEnrollTotp?: boolean; mustChangePassword?: boolean; sessionId?: string } | null;
};

function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(value);
      } catch {
        result[key] = value;
      }
    }
  }
  return result;
}

// L'en-tête n'est envoyé que par le client natif (stockage sécurisé du système, cf. lib/tikisse-session.ts) ;
// le client web s'appuie uniquement sur le cookie httpOnly ci-dessous, jamais lisible ni renvoyable par
// un script injecté. Ne jamais faire porter ce jeton par le client web via un en-tête/sessionStorage : cela
// annulerait la protection XSS que ce cookie httpOnly existe précisément pour apporter.
export function getTikisseSessionTokenFromHeaders(headers: Record<string, string | string[] | undefined>): string | undefined {
  // Renommage Tikis → Tikisse : contrairement au cookie web (posé et relu par le même déploiement serveur),
  // l'app mobile déjà installée peut continuer d'envoyer l'ancien nom d'en-tête tant qu'elle n'a pas reçu la
  // mise à jour qui le renomme (lib/tikisse-session.ts) — le serveur, lui, change instantanément au déploiement.
  const headerValue = headers["x-tikisse-session"] ?? headers["x-tikisse-profile-session"] ?? headers["x-tikis-session"];
  const headerToken = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return headerToken;
}

export function shouldAuthenticateManusRequest(headers: Record<string, string | string[] | undefined>): boolean {
  const authorization = headers.authorization;
  const bearer = Array.isArray(authorization) ? authorization[0] : authorization;
  if (typeof bearer === "string" && /^Bearer\s+\S+/i.test(bearer)) return true;
  const cookie = headers.cookie;
  const cookieValue = Array.isArray(cookie) ? cookie[0] : cookie;
  return typeof cookieValue === "string" && /(?:^|;\s*)app_session_id=/.test(cookieValue);
}

function requestCookies(opts: CreateExpressContextOptions): Record<string, string> {
  const reqWithCookies = opts.req as { cookies?: Record<string, string> };
  if (!reqWithCookies.cookies) {
    reqWithCookies.cookies = parseCookies(opts.req.headers.cookie);
  }
  return reqWithCookies.cookies;
}

export function pickTikisseSessionToken(opts: CreateExpressContextOptions): string | undefined {
  const headerToken = getTikisseSessionTokenFromHeaders(opts.req.headers);
  if (headerToken) return headerToken;
  const cookies = requestCookies(opts);
  // Renommage Tikis → Tikisse : un navigateur déjà connecté avant le déploiement porte encore l'ancien
  // cookie ; il sera remplacé par le nouveau à la prochaine connexion (setTikisseProfileCookie).
  return cookies[TIKISSE_PROFILE_COOKIE] ?? cookies[LEGACY_TIKIS_PROFILE_COOKIE];
}

/**
 * Jeton de session admin : uniquement le cookie httpOnly, et seulement si la requête porte l'en-tête de la
 * console. Un site tiers peut amener le navigateur à envoyer un cookie ; il ne peut pas ajouter cet en-tête
 * sans pré-vérification CORS, que seules les origines autorisées passent. L'ancien en-tête portant le jeton
 * lui-même (lu depuis localStorage) n'est plus accepté.
 */
/**
 * Cookie de session admin seul, sans l'en-tête de la console : réservé aux GET d'images (pièces KYC), qu'une
 * balise <img> charge sans pouvoir ajouter d'en-tête. Sans risque CSRF pour une lecture : SameSite=Strict
 * empêche un autre site de faire envoyer le cookie, et une page d'un autre domaine ne peut pas lire l'image.
 */
export function adminSessionCookieValue(req: Pick<CreateExpressContextOptions["req"], "headers">): string | undefined {
  const cookies = requestCookies({ req } as CreateExpressContextOptions);
  return cookies[ADMIN_SESSION_COOKIE] ?? cookies[LEGACY_ADMIN_SESSION_COOKIE];
}

export function pickAdminSessionToken(opts: Pick<CreateExpressContextOptions, "req">): string | undefined {
  const marker = opts.req.headers[ADMIN_CONSOLE_HEADER];
  if ((Array.isArray(marker) ? marker[0] : marker) !== "1") return undefined;
  const cookies = requestCookies(opts as CreateExpressContextOptions);
  // Renommage Tikis → Tikisse : un admin déjà connecté avant le déploiement porte encore l'ancien cookie.
  return cookies[ADMIN_SESSION_COOKIE] ?? cookies[LEGACY_ADMIN_SESSION_COOKIE];
}

/** Numéro du profil connecté, sauf si l'équipe Tikisse a forcé la déconnexion de ses sessions depuis. */
async function authenticateTikisseProfile(sessionToken: string | undefined) {
  const claims = await verifyTikisseProfileSessionClaims(sessionToken);
  if (!claims) return null;
  const profile = await getCachedTikisseProfile(claims.phone).catch(() => undefined);
  if (profile && isRevokedByProfile(claims.issuedAt, profile.sessionsRevokedAt)) return null;
  return claims.phone;
}

export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  let user: User | null = null;
  const sessionToken = pickTikisseSessionToken(opts);
  const adminSessionToken = pickAdminSessionToken(opts);

  if (shouldAuthenticateManusRequest(opts.req.headers)) {
    try {
      user = await sdk.authenticateRequest(opts.req);
    } catch {
      user = null;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    tikisseProfilePhone: await authenticateTikisseProfile(sessionToken),
    // Relit le compte à chaque requête : un admin suspendu ou rétrogradé perd ses droits tout de suite.
    tikisseAdmin: await authenticateAdminSession(adminSessionToken),
  };
}
