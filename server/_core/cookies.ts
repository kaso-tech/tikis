import type { CookieOptions, Request, Response } from "express";
import { TIKISSE_SESSION_TTL_SECONDS } from "../tikisse-session";
import { ADMIN_SESSION_COOKIE } from "../admin-auth";

export function getSessionCookieOptions(
  req: Request,
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  // Sans TIKISSE_COOKIE_DOMAIN, aucun domaine : le cookie ne vaut que pour l'hôte exact de l'API, ce qui suffit
  // (l'application ne le lit jamais, il est httpOnly ; il n'a qu'à revenir à l'API). Il n'est jamais déduit de
  // l'en-tête Host, que le client choisit. TIKISSE_COOKIE_DOMAIN (ex. « .tikisse.app ») ne sert que si
  // plusieurs sous-domaines doivent le recevoir.
  const domain = process.env.TIKISSE_COOKIE_DOMAIN?.trim() || process.env.TIKIS_COOKIE_DOMAIN?.trim() || undefined;

  return {
    domain,
    httpOnly: true,
    path: "/",
    // Same-site : `None` admettait le cookie sur une requête cross-site, une protection CSRF
    // bien plus faible que ce que ce cookie a jamais eu besoin ici.
    sameSite: "lax",
    // `req.secure` respecte `app.set("trust proxy", 1)` (server/_core/index.ts) : sur tout trafic
    // réel — production, toujours HTTPS — il vaut donc toujours `true`. Rester dérivé de la
    // requête, plutôt que forcé en dur, laisse le développement local (HTTP) fonctionner.
    secure: req.secure,
  };
}

export const TIKISSE_PROFILE_COOKIE = "tikisse-profile-session";
// Renommage Tikis → Tikisse : nom du cookie posé avant le renommage. Un navigateur déjà connecté le porte
// encore ; server/_core/context.ts le relit en secours pour ne pas déconnecter le web au déploiement. Il
// disparaît de lui-même (le cookie expire, ou est remplacé par TIKISSE_PROFILE_COOKIE à la prochaine
// connexion) : rien à retirer explicitement plus tard.
export const LEGACY_TIKIS_PROFILE_COOKIE = "tikis-profile-session";
// Dérivé de la durée de vie du jeton lui-même : un cookie qui expire avant le JWT qu'il transporte
// déconnecterait le web plus tôt que le natif, sans raison.
export const TIKISSE_PROFILE_COOKIE_MAX_AGE_MS = TIKISSE_SESSION_TTL_SECONDS * 1000;

export function setTikisseProfileCookie(res: Pick<Response, "cookie" | "clearCookie">, req: Request, token: string) {
  if (!res || typeof (res as { cookie?: unknown }).cookie !== "function") return;
  res.cookie(TIKISSE_PROFILE_COOKIE, token, { ...getSessionCookieOptions(req), maxAge: TIKISSE_PROFILE_COOKIE_MAX_AGE_MS });
}

export function clearTikisseProfileCookie(res: Pick<Response, "cookie" | "clearCookie">, req: Request) {
  if (!res || typeof (res as { cookie?: unknown }).cookie !== "function") return;
  res.clearCookie(TIKISSE_PROFILE_COOKIE, getSessionCookieOptions(req));
}

/**
 * Cookie de session de la console d'administration. Plus strict que celui des profils :
 *  - pas de domaine : le cookie ne vaut que pour l'hôte de l'API, jamais pour ses sous-domaines voisins ;
 *  - SameSite=Strict : aucune requête partie d'un autre site ne le transporte ;
 *  - chemin /api : les pages statiques ne le reçoivent pas.
 * Toujours httpOnly : aucun script de la page ne peut le lire, contrairement à l'ancien jeton en localStorage.
 */
function adminSessionCookieOptions(req: Request): CookieOptions {
  return { httpOnly: true, sameSite: "strict", path: "/api", secure: req.secure };
}

export function setAdminSessionCookie(res: Pick<Response, "cookie" | "clearCookie">, req: Request, token: string, expiresAt: Date) {
  if (!res || typeof (res as { cookie?: unknown }).cookie !== "function") return;
  res.cookie(ADMIN_SESSION_COOKIE, token, { ...adminSessionCookieOptions(req), expires: expiresAt });
}

export function clearAdminSessionCookie(res: Pick<Response, "cookie" | "clearCookie">, req: Request) {
  if (!res || typeof (res as { cookie?: unknown }).cookie !== "function") return;
  res.clearCookie(ADMIN_SESSION_COOKIE, adminSessionCookieOptions(req));
}
