import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { verifyTikisProfileSession } from "../tikis-session";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  tikisProfilePhone: string | null;
};

export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  let user: User | null = null;
  const sessionHeader = opts.req.headers["x-tikis-session"];
  const sessionToken = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;

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
  };
}
