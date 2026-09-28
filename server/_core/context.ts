import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { isRevokedByProfile, verifyTikisProfileSessionClaims } from "../tikis-session";
import { getCachedTikisProfile } from "./profile-cache";
import { ADMIN_CONSOLE_HEADER, ADMIN_SESSION_COOKIE, type AdminRole } from "../admin-auth";
import { authenticateAdminSession } from "../admin-db";
import { TIKIS_PROFILE_COOKIE } from "./cookies";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  tikisProfilePhone: string | null;
  tikisAdmin?: { adminId: number; email: string; role: AdminRole; totpEnabled?: boolean; mustEnrollTotp?: boolean; mustChangePassword?: boolean; sessionId?: string } | null;
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

// L'en-tête n'est envoyé que par le client natif (stockage sécurisé du système, cf. lib/tikis-session.ts) ;
// le client web s'appuie uniquement sur le cookie httpOnly ci-dessous, jamais lisible ni renvoyable par
// un script injecté. Ne jamais faire porter ce jeton par le client web via un en-tête/sessionStorage : cela
// annulerait la protection XSS que ce cookie httpOnly existe précisément pour apporter.
export function getTikisSessionTokenFromHeaders(headers: Record<string, string | string[] | undefined>): string | undefined {
  const headerValue = headers["x-tikis-session"] ?? headers["x-tikis-profile-session"];
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

function pickTikisSessionToken(opts: CreateExpressContextOptions): string | undefined {
  const headerToken = getTikisSessionTokenFromHeaders(opts.req.headers);
  if (headerToken) return headerToken;
  return requestCookies(opts)[TIKIS_PROFILE_COOKIE];
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
  return requestCookies({ req } as CreateExpressContextOptions)[ADMIN_SESSION_COOKIE];
}

export function pickAdminSessionToken(opts: Pick<CreateExpressContextOptions, "req">): string | undefined {
  const marker = opts.req.headers[ADMIN_CONSOLE_HEADER];
  if ((Array.isArray(marker) ? marker[0] : marker) !== "1") return undefined;
  return requestCookies(opts as CreateExpressContextOptions)[ADMIN_SESSION_COOKIE];
}

/** Numéro du profil connecté, sauf si l'équipe Tikis a forcé la déconnexion de ses sessions depuis. */
async function authenticateTikisProfile(sessionToken: string | undefined) {
  const claims = await verifyTikisProfileSessionClaims(sessionToken);
  if (!claims) return null;
  const profile = await getCachedTikisProfile(claims.phone).catch(() => undefined);
  if (profile && isRevokedByProfile(claims.issuedAt, profile.sessionsRevokedAt)) return null;
  return claims.phone;
}

export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  let user: User | null = null;
  const sessionToken = pickTikisSessionToken(opts);
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
    tikisProfilePhone: await authenticateTikisProfile(sessionToken),
    // Relit le compte à chaque requête : un admin suspendu ou rétrogradé perd ses droits tout de suite.
    tikisAdmin: await authenticateAdminSession(adminSessionToken),
  };
}
