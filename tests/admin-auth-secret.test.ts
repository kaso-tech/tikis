import { describe, expect, it } from "vitest";
import { createAdminSession, verifyAdminSession } from "../server/admin-auth";

describe("signature de session administrateur", () => {
  const checkConfiguredSecret = process.env.TIKIS_ADMIN_SESSION_SECRET ? it : it.skip;

  checkConfiguredSecret("signe puis vérifie une session avec le secret serveur configuré", async () => {
    expect(process.env.TIKIS_ADMIN_SESSION_SECRET?.length ?? 0).toBeGreaterThanOrEqual(24);

    const token = await createAdminSession(42, "admin@example.com", "super_admin");
    const session = await verifyAdminSession(token);

    expect(session).toEqual({ adminId: 42, email: "admin@example.com", role: "super_admin" });
  });
});
