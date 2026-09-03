import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../server/_core/context";

const adminDbMock = vi.hoisted(() => ({
  adminSearchProfiles: vi.fn(),
}));

vi.mock("../server/admin-db", () => adminDbMock);

import { tikisAdminRouter } from "../server/admin-router";

function createAdminContext(): TrpcContext {
  return {
    user: null,
    tikisProfilePhone: null,
    tikisAdmin: { adminId: 1, email: "admin@tikis.app", role: "super_admin" },
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("liste des utilisateurs de la console", () => {
  beforeEach(() => vi.clearAllMocks());

  it("charge les profils récents sans imposer de recherche initiale", async () => {
    const profiles = [{ phone: "+22670000000", fullName: "Aïcha Traoré", accountType: "sender", email: null }];
    adminDbMock.adminSearchProfiles.mockResolvedValue({ rows: profiles, total: profiles.length });

    const caller = tikisAdminRouter.createCaller(createAdminContext());
    await expect(caller.users.search({})).resolves.toEqual({ rows: profiles, total: 1, limit: 25, offset: 0 });
    expect(adminDbMock.adminSearchProfiles).toHaveBeenCalledWith({ query: undefined, limit: 25, offset: 0 });
  });
});
