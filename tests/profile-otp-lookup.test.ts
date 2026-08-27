import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../server/_core/context";

const dbMock = vi.hoisted(() => ({ getTikisProfileByPhone: vi.fn() }));
vi.mock("../server/db", () => dbMock);
vi.mock("../server/tikis-session", () => ({ createTikisProfileSession: vi.fn().mockResolvedValue("session_tikis_signee") }));

import { appRouter } from "../server/routers";

const existingProfile = { phone: "+22676767676", fullName: "Aïcha Traoré", accountType: "sender" as const, vehicles: "[]", referralCode: null, photoKey: null };
const context = { user: null, tikisProfilePhone: null, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => undefined } as unknown as TrpcContext["res"] };

describe("connexion OTP des profils existants", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retourne immédiatement le profil et une session sans chemin d’inscription", async () => {
    dbMock.getTikisProfileByPhone.mockResolvedValue(existingProfile);
    const caller = appRouter.createCaller(context);
    await expect(caller.profiles.lookup({ phone: "+22676767676", otp: "730512" })).resolves.toMatchObject({ sessionToken: "session_tikis_signee", profile: { phone: existingProfile.phone, role: "sender", fullName: existingProfile.fullName } });
    expect(dbMock.getTikisProfileByPhone).toHaveBeenCalledTimes(1);
  });

  it("retourne null uniquement lorsqu’aucun profil ne correspond au numéro vérifié", async () => {
    dbMock.getTikisProfileByPhone.mockResolvedValue(null);
    const caller = appRouter.createCaller(context);
    await expect(caller.profiles.lookup({ phone: "+22670000000", otp: "730512" })).resolves.toBeNull();
  });
});
