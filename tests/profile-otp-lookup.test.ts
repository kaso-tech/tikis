import { beforeEach, describe, expect, it, vi } from "vitest";
import { afterEach } from "vitest";
import type { TrpcContext } from "../server/_core/context";

const dbMock = vi.hoisted(() => ({ getTikisProfileByPhone: vi.fn(), linkTikisProfileToSupabaseUser: vi.fn() }));
vi.mock("../server/db", () => dbMock);
vi.mock("../server/tikis-session", () => ({ createTikisProfileSession: vi.fn().mockResolvedValue("session_tikis_signee") }));

import { appRouter } from "../server/routers";

const existingProfile = { phone: "+22676767676", fullName: "Aïcha Traoré", accountType: "sender" as const, vehicles: "[]", referralCode: null, photoKey: null };
const context = { user: null, tikisProfilePhone: null, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => undefined } as unknown as TrpcContext["res"] };

describe("connexion OTP des profils existants", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

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

  it("réconcilie le lien Supabase d’un profil existant après la vérification du même numéro", async () => {
    vi.stubEnv("EXPO_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY", "anon-key-for-auth-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "supabase-user-current", phone: existingProfile.phone }) }));
    dbMock.getTikisProfileByPhone.mockResolvedValue(existingProfile);
    dbMock.linkTikisProfileToSupabaseUser.mockResolvedValue({ ...existingProfile, supabaseUserId: "supabase-user-current" });

    const caller = appRouter.createCaller(context);
    await expect(caller.profiles.lookupSupabase({ phone: existingProfile.phone, accessToken: "t".repeat(80) })).resolves.toMatchObject({
      sessionToken: "session_tikis_signee",
      profile: { phone: existingProfile.phone, role: "sender" },
    });
    expect(dbMock.linkTikisProfileToSupabaseUser).toHaveBeenCalledWith(existingProfile.phone, "supabase-user-current");
  });

  it("propage une indisponibilité de profils au lieu de faire croire qu’aucun compte n’existe", async () => {
    dbMock.getTikisProfileByPhone.mockRejectedValue(new Error("Le service des profils est temporairement indisponible."));
    const caller = appRouter.createCaller(context);
    await expect(caller.profiles.lookup({ phone: "+22676767676", otp: "730512" })).rejects.toThrow("Le service des profils est temporairement indisponible.");
  });
});
