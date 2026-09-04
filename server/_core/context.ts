import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { verifyTikisProfileSession } from "../tikis-session";
import { verifyAdminSession, type AdminRole } from "../admin-auth";
import { TIKIS_PROFILE_COOKIE } from "./cookies";
import { COOKIE_NAME } from "../../shared/const";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  tikisProfilePhone: string | null;
  tikisAdmin?: { adminId: number; email: string; role: AdminRole } | null;
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

type SessionHeaders = Record<string, string | string[] | undefined>;

export function getTikisSessionTokenFromHeaders(headers: SessionHeaders): string | undefined {
  const current = headers["x-tikis-session"];
  const legacy = headers["x-tikis-profile-session"];
  const token = Array.isArray(current) ? current[0] : current;
  if (token) return token;
  return Array.isArray(legacy) ? legacy[0] : legacy;
}

export function shouldAuthenticateManusRequest(headers: SessionHeaders): boolean {
  const authorization = headers.authorization;
  const bearer = Array.isArray(authorization) ? authorization[0] : authorization;
  if (typeof bearer === "string" && bearer.startsWith("Bearer ")) return true;
  const cookieHeader = headers.cookie;
  const cookies = parseCookies(Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader);
  return Boolean(cookies[COOKIE_NAME]);
}

function pickTikisSessionToken(opts: CreateExpressContextOptions): string | undefined {
  const headerToken = getTikisSessionTokenFromHeaders(opts.req.headers);
  if (headerToken) return headerToken;
  const reqWithCookies = opts.req as { cookies?: Record<string, string> };
  if (!reqWithCookies.cookies) {
    reqWithCookies.cookies = parseCookies(opts.req.headers.cookie);
  }
  return reqWithCookies.cookies[TIKIS_PROFILE_COOKIE];
}

export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  let user: User | null = null;
  const sessionToken = pickTikisSessionToken(opts);
  const adminSessionHeader = opts.req.headers["x-tikis-admin-session"];
  const adminSessionToken = Array.isArray(adminSessionHeader) ? adminSessionHeader[0] : adminSessionHeader;

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
    tikisProfilePhone: await verifyTikisProfileSession(sessionToken),
    tikisAdmin: await verifyAdminSession(adminSessionToken),
  };
}
