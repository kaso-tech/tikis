import type { Request, Response, NextFunction } from "express";

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
    "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Tikis-Admin-Session, X-Tikis-Profile-Session",
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

type RateLimitEntry = {
  count: number;
  windowStart: number;
  blockedUntil: number;
};

export type RateLimitOptions = {
  windowMs: number;
  max: number;
  blockDurationMs?: number;
  keyBy?: (req: Request) => string;
  message?: string;
};

const stores = new Map<string, Map<string, RateLimitEntry>>();

function unrefTimer(timer: ReturnType<typeof setInterval>) {
  (timer as unknown as { unref?: () => void }).unref?.();
}

export function createRateLimiter(options: RateLimitOptions) {
  const { windowMs, max, blockDurationMs = windowMs, keyBy = defaultKeyByIp, message = "Trop de requêtes, réessayez plus tard." } = options;
  const store = new Map<string, RateLimitEntry>();
  const storeKey = `limiter:${windowMs}:${max}:${blockDurationMs}`;

  if (!stores.has(storeKey)) stores.set(storeKey, store);
  const target = stores.get(storeKey)!;

  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of target.entries()) {
      if (now - entry.windowStart > windowMs * 2 && (!entry.blockedUntil || entry.blockedUntil < now)) {
        target.delete(key);
      }
    }
  }, Math.max(60_000, windowMs));
  unrefTimer(cleanupTimer);

  return function rateLimit(req: Request, res: Response, next: NextFunction) {
    const key = keyBy(req);
    if (!key) return next();
    const now = Date.now();
    const entry = target.get(key);

    if (entry?.blockedUntil && entry.blockedUntil > now) {
      const retryAfter = Math.ceil((entry.blockedUntil - now) / 1000);
      res.header("Retry-After", String(retryAfter));
      res.status(429).json({ error: { message, code: "RATE_LIMITED", retryAfter } });
      return;
    }

    if (!entry || now - entry.windowStart > windowMs) {
      target.set(key, { count: 1, windowStart: now, blockedUntil: 0 });
      res.header("X-RateLimit-Limit", String(max));
      res.header("X-RateLimit-Remaining", String(max - 1));
      res.header("X-RateLimit-Reset", String(Math.ceil((now + windowMs) / 1000)));
      return next();
    }

    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);
    res.header("X-RateLimit-Limit", String(max));
    res.header("X-RateLimit-Remaining", String(remaining));
    res.header("X-RateLimit-Reset", String(Math.ceil((entry.windowStart + windowMs) / 1000)));

    if (entry.count > max) {
      entry.blockedUntil = now + blockDurationMs;
      const retryAfter = Math.ceil(blockDurationMs / 1000);
      res.header("Retry-After", String(retryAfter));
      res.status(429).json({ error: { message, code: "RATE_LIMITED", retryAfter } });
      return;
    }
    next();
  };
}

function defaultKeyByIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

export const publicApiRateLimit = createRateLimiter({ windowMs: 60_000, max: 60 });
export const authRateLimit = createRateLimiter({ windowMs: 10 * 60_000, max: 10, blockDurationMs: 30 * 60_000 });
export const registerRateLimit = createRateLimiter({ windowMs: 60 * 60_000, max: 5, blockDurationMs: 60 * 60_000 });
export const geographyRateLimit = createRateLimiter({ windowMs: 60_000, max: 30 });

type TrpcRateLimited = { req?: Request; info?: { calls?: Map<string, { count: number; windowStart: number; blockedUntil: number }> } };
const trpcCounters = new Map<string, { count: number; windowStart: number; blockedUntil: number }>();

export function trpcRateLimit(options: { windowMs: number; max: number; blockDurationMs?: number; keyBy?: (input: unknown, ctx: unknown) => string | null; message?: string }) {
  const { windowMs, max, blockDurationMs = windowMs, keyBy, message = "Trop de tentatives, réessayez plus tard." } = options;
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of trpcCounters.entries()) {
      if (now - entry.windowStart > windowMs * 2 && (!entry.blockedUntil || entry.blockedUntil < now)) {
        trpcCounters.delete(key);
      }
    }
  }, Math.max(60_000, windowMs));
  unrefTimer(cleanupTimer);

  return function rateLimitMiddleware({ ctx, next, path }: { ctx: unknown; next: () => Promise<unknown>; path: string }) {
    const trpcCtx = ctx as TrpcRateLimited;
    const request = trpcCtx?.req;
    const forwarded = request?.headers?.["x-forwarded-for"];
    const ip = (typeof forwarded === "string" && forwarded.length > 0 ? forwarded.split(",")[0].trim() : request?.socket?.remoteAddress) ?? "unknown";
    const key = keyBy ? `${path}:${keyBy(undefined, ctx) ?? ip}` : `${path}:${ip}`;
    const now = Date.now();
    const entry = trpcCounters.get(key);
    if (entry?.blockedUntil && entry.blockedUntil > now) {
      const retryAfter = Math.ceil((entry.blockedUntil - now) / 1000);
      const error = new Error(message);
      (error as Error & { code?: string }).code = "RATE_LIMITED";
      throw error;
    }
    if (!entry || now - entry.windowStart > windowMs) {
      trpcCounters.set(key, { count: 1, windowStart: now, blockedUntil: 0 });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      entry.blockedUntil = now + blockDurationMs;
      const retryAfter = Math.ceil(blockDurationMs / 1000);
      const error = new Error(message);
      (error as Error & { code?: string; data?: { retryAfter: number } }).code = "RATE_LIMITED";
      (error as Error & { code?: string; data?: { retryAfter: number } }).data = { retryAfter };
      throw error;
    }
    return next();
  };
}
