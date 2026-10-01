import { describe, expect, it } from "vitest";
import { appRouter } from "../server/routers";
import { TIKISSE_PROFILE_COOKIE } from "../server/_core/cookies";
import type { TrpcContext } from "../server/_core/context";

describe("auth.logout", () => {
  it("efface le cookie de session Tikisse (web) et répond succès, même sans session", async () => {
    const cleared: Array<{ name: string; options: Record<string, unknown> }> = [];
    const ctx: TrpcContext = {
      tikisseProfilePhone: null,
      req: { protocol: "https", secure: true, hostname: "api.tikisse.app", headers: {} } as unknown as TrpcContext["req"],
      res: {
        cookie: () => undefined,
        clearCookie: (name: string, options: Record<string, unknown>) => { cleared.push({ name, options }); },
      } as unknown as TrpcContext["res"],
    };
    const result = await appRouter.createCaller(ctx).auth.logout();
    expect(result).toEqual({ success: true });
    expect(cleared.map((cookie) => cookie.name)).toEqual([TIKISSE_PROFILE_COOKIE]);
    expect(cleared[0]?.options).toMatchObject({ httpOnly: true, path: "/", sameSite: "lax", secure: true });
  });
});
