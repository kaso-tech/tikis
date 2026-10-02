import { describe, expect, it } from "vitest";
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";

describe("profiles.update", () => {
  it("exige la session Tikisse : le numéro et le code de simulation ne suffisent plus", async () => {
    const ctx: TrpcContext = {
      tikisseProfilePhone: null,
      req: { protocol: "https", secure: true, hostname: "api.tikisse.com", headers: {} } as unknown as TrpcContext["req"],
      res: { cookie: () => undefined, clearCookie: () => undefined } as unknown as TrpcContext["res"],
    };
    await expect(
      appRouter.createCaller(ctx).profiles.update({ phone: "+22670000000", otp: "730512", fullName: "Nom Pirate" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
