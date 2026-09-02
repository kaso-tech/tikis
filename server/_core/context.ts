import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { verifyTikisProfileSession } from "../tikis-session";
import { verifyAdminSession, type AdminRole } from "../admin-auth";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  tikisProfilePhone: string | null;
  tikisAdmin?: { adminId: number; email: string; role: AdminRole } | null;
};

export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  let user: User | null = null;
  const sessionHeader = opts.req.headers["x-tikis-session"];
  const sessionToken = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
  const adminSessionHeader = opts.req.headers["x-tikis-admin-session"];
  const adminSessionToken = Array.isArray(adminSessionHeader) ? adminSessionHeader[0] : adminSessionHeader;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // Authentication is optional for public procedures.
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
