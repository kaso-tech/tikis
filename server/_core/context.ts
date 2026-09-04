import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { verifyTikisProfileSession } from "../tikis-session";
import { verifyAdminSession, type AdminRole } from "../admin-auth";
import { TIKIS_PROFILE_COOKIE } from "./cookies";

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

// L'en-tête n'est envoyé que par le client natif (stockage sécurisé du système, cf. lib/tikis-session.ts) ;
// le client web s'appuie uniquement sur le cookie httpOnly ci-dessous, jamais lisible ni renvoyable par
// un script injecté. Ne jamais faire porter ce jeton par le client web via un en-tête/sessionStorage : cela
// annulerait la protection XSS que ce cookie httpOnly existe précisément pour apporter.
function pickTikisSessionToken(opts: CreateExpressContextOptions): string | undefined {
  const headerValue = opts.req.headers["x-tikis-session"];
  const headerToken = Array.isArray(headerValue) ? headerValue[0] : headerValue;
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

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    tikisProfilePhone: await verifyTikisProfileSession(sessionToken),
    tikisAdmin: await verifyAdminSession(adminSessionToken),
  };
}
