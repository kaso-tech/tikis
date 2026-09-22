import type { NextFunction, Request, Response } from "express";
import { checkDistributedRateLimit } from "../db";

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:8081",
  "http://localhost:8082",
  "http://localhost:3000",
  "http://localhost:5173",
  "https://admin.tikis.app",
  "https://app.tikis.app",
];

function parseAllowedOrigins(): Set<string> {
  const fromEnv = (process.env.TIKIS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...fromEnv]);
}

const allowedOrigins = parseAllowedOrigins();

export function corsMiddleware(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
    res.header("Access-Control-Allow-Credentials", "true");
  } else if (!origin) {
    res.header("Access-Control-Allow-Origin", "*");
  }
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Tikis-Admin-Session, X-Tikis-Session, X-Tikis-Profile-Session",
  );
  res.header("Access-Control-Expose-Headers", "X-Tikis-Request-Id");
  res.header("Access-Control-Max-Age", "600");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
}

export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction) {
  res.header("X-Content-Type-Options", "nosniff");
  res.header("X-Frame-Options", "DENY");
  res.header("Referrer-Policy", "strict-origin-when-cross-origin");
  res.header("Permissions-Policy", "geolocation=(self), camera=(self), microphone=()");
  res.header("Cross-Origin-Opener-Policy", "same-origin");
  res.header("Cross-Origin-Resource-Policy", "same-site");
  if (process.env.NODE_ENV === "production") {
    res.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

/**
 * L'IP du client, telle que la connexion TCP l'établit — jamais telle qu'un
 * en-tête prétend qu'elle est.
 *
 * `req.ip` respecte `app.set("trust proxy", …)` (posé une fois dans
 * `server/_core/index.ts`) : sans cette configuration, Express ignore
 * `X-Forwarded-For` et ne retient que l'adresse de la connexion, qu'un client
 * ne peut pas falsifier. Une lecture manuelle de l'en-tête — ce que faisaient
 * cette fonction et `clientIp` de `admin-router.ts`, chacune de son côté —
 * l'accepte même quand rien de confiance ne l'a posé : n'importe quel client
 * se donne alors une IP neuve à chaque appel et reçoit un compteur à zéro à
 * chaque fois, sur le rate-limit général comme sur la limite de connexion
 * admin.
 */
export function clientIp(req: { ip?: string; socket?: { remoteAddress?: string } }): string {
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}

function defaultKeyByIp(req: Request): string {
  return clientIp(req);
}

export type RateLimitOptions = {
  /** Espace de nommage des compteurs en base — distinct pour chaque appelant. */
  scope: string;
  windowMs: number;
  max: number;
  keyBy?: (req: Request) => string;
  message?: string;
};

/**
 * Limite de requêtes partagée entre toutes les instances du serveur.
 *
 * S'appuie sur `checkDistributedRateLimit` (table `tikis_rate_limits`), pas
 * sur un compteur en mémoire de processus : ce dernier ne protège que
 * l'instance qui le détient, et un client réparti sur plusieurs connexions —
 * ou simplement plusieurs instances derrière le même équilibreur — pouvait y
 * multiplier la limite effective par le nombre d'instances.
 */
export function createRateLimiter(options: RateLimitOptions) {
  const { scope, windowMs, max, keyBy = defaultKeyByIp, message = "Trop de requêtes, réessayez plus tard." } = options;
  return function rateLimit(req: Request, res: Response, next: NextFunction) {
    const key = keyBy(req);
    if (!key || key === "unknown") return void next();
    void checkDistributedRateLimit(scope, key, windowMs, max)
      .then((allowed) => {
        if (allowed) return next();
        const retryAfter = Math.ceil(windowMs / 1000);
        res.header("Retry-After", String(retryAfter));
        res.status(429).json({ error: { message, code: "RATE_LIMITED", retryAfter } });
      })
      // Panne du contrôle lui-même (base indisponible) : ne jamais bloquer
      // l'usage à cause d'un souci d'infrastructure du rate-limit — même
      // philosophie que `checkDistributedRateLimit`.
      .catch(() => next());
  };
}

export const publicApiRateLimit = createRateLimiter({ scope: "public-api", windowMs: 60_000, max: 60 });
