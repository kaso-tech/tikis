import type { CookieOptions, Request, Response } from "express";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isIpAddress(host: string) {
  // Basic IPv4 check and IPv6 presence detection.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
}

/**
 * Extract parent domain for cookie sharing across subdomains.
 * e.g., "3000-xxx.manuspre.computer" -> ".manuspre.computer"
 * This allows cookies set by 3000-xxx to be read by 8081-xxx
 *
 * Réservé aux environnements de prévisualisation, dont les sous-domaines
 * changent à chaque session. En production, `TIKIS_COOKIE_DOMAIN` (plus bas)
 * fixe la valeur au lieu de la dériver de l'en-tête `Host` de la requête : le
 * dériver dynamiquement revenait à laisser quiconque contrôle cet en-tête
 * choisir le domaine sur lequel le cookie de session s'applique.
 */
function getParentDomain(hostname: string): string | undefined {
  // Don't set domain for localhost or IP addresses
  if (LOCAL_HOSTS.has(hostname) || isIpAddress(hostname)) {
    return undefined;
  }

  // Split hostname into parts
  const parts = hostname.split(".");

  // Need at least 3 parts for a subdomain (e.g., "3000-xxx.manuspre.computer")
  // For "manuspre.computer", we can't set a parent domain
  if (parts.length < 3) {
    return undefined;
  }

  // Return parent domain with leading dot (e.g., ".manuspre.computer")
  // This allows cookie to be shared across all subdomains
  return "." + parts.slice(-2).join(".");
}

export function getSessionCookieOptions(
  req: Request,
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  // En production, TIKIS_COOKIE_DOMAIN fixe le domaine explicitement (ex. ".tikis.app") plutôt
  // que de le recalculer depuis l'en-tête Host de chaque requête — un en-tête que le client
  // choisit. Sans cette variable (environnements de prévisualisation, développement local), le
  // calcul dynamique historique reste le seul moyen de partager le cookie entre sous-domaines
  // éphémères.
  const fixedDomain = process.env.TIKIS_COOKIE_DOMAIN?.trim();
  const domain = fixedDomain || getParentDomain(req.hostname);

  return {
    domain,
    httpOnly: true,
    path: "/",
    // Same-site pour tout trafic réel (mêmes domaines parents des deux côtés, fixe ou dynamique
    // ci-dessus) : `None` admettait le cookie sur une requête cross-site, une protection CSRF
    // bien plus faible que ce que ce cookie a jamais eu besoin ici.
    sameSite: "lax",
    // `req.secure` respecte `app.set("trust proxy", 1)` (server/_core/index.ts) : sur tout trafic
    // réel — production, toujours HTTPS — il vaut donc toujours `true`. Rester dérivé de la
    // requête, plutôt que forcé en dur, laisse le développement local (HTTP) fonctionner.
    secure: req.secure,
  };
}

export const TIKIS_PROFILE_COOKIE = "tikis-profile-session";
export const TIKIS_PROFILE_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function setTikisProfileCookie(res: Pick<Response, "cookie" | "clearCookie">, req: Request, token: string) {
  if (!res || typeof (res as { cookie?: unknown }).cookie !== "function") return;
  res.cookie(TIKIS_PROFILE_COOKIE, token, { ...getSessionCookieOptions(req), maxAge: TIKIS_PROFILE_COOKIE_MAX_AGE_MS });
}

export function clearTikisProfileCookie(res: Pick<Response, "cookie" | "clearCookie">, req: Request) {
  if (!res || typeof (res as { cookie?: unknown }).cookie !== "function") return;
  res.clearCookie(TIKIS_PROFILE_COOKIE, getSessionCookieOptions(req));
}
