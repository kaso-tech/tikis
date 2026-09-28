import { beforeEach, describe, expect, it, vi } from "vitest";
import { afterEach } from "vitest";
import type { TrpcContext } from "../server/_core/context";

// La limite de tentatives par numéro est en base (lot D) : ici, jamais atteinte.
const dbMock = vi.hoisted(() => ({ getTikisseProfileByPhone: vi.fn(), linkTikisseProfileToSupabaseUser: vi.fn(), checkPhoneAttemptLimit: vi.fn(async () => ({ allowed: true as const })) }));
vi.mock("../server/db", () => dbMock);
// Mock partiel : seule la signature est remplacée. Remplacer tout le module effaçait aussi
// `TIKISSE_SESSION_TTL_SECONDS`, dont dépend la durée du cookie de session (server/_core/cookies.ts).
vi.mock("../server/tikisse-session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/tikisse-session")>()),
  createTikisseProfileSession: vi.fn().mockResolvedValue("session_tikisse_signee"),
}));

import { appRouter } from "../server/routers";

const existingProfile = { phone: "+22676767676", fullName: "Aïcha Traoré", accountType: "sender" as const, vehicles: "[]", referralCode: null, photoKey: null };
const context = { user: null, tikisseProfilePhone: null, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => undefined } as unknown as TrpcContext["res"] };

describe("connexion OTP des profils existants", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("retourne immédiatement le profil et une session sans chemin d’inscription", async () => {
    dbMock.getTikisseProfileByPhone.mockResolvedValue(existingProfile);
    const caller = appRouter.createCaller(context);
    await expect(caller.profiles.lookup({ phone: "+22676767676", otp: "730512" })).resolves.toMatchObject({ sessionToken: "session_tikisse_signee", profile: { phone: existingProfile.phone, role: "sender", fullName: existingProfile.fullName } });
    expect(dbMock.getTikisseProfileByPhone).toHaveBeenCalledTimes(1);
  });

  it("retourne null uniquement lorsqu’aucun profil ne correspond au numéro vérifié", async () => {
    dbMock.getTikisseProfileByPhone.mockResolvedValue(null);
    const caller = appRouter.createCaller(context);
    await expect(caller.profiles.lookup({ phone: "+22670000000", otp: "730512" })).resolves.toBeNull();
  });

  it("réconcilie le lien Supabase d’un profil existant après la vérification du même numéro", async () => {
    vi.stubEnv("EXPO_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY", "anon-key-for-auth-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "supabase-user-current", phone: existingProfile.phone }) }));
    dbMock.getTikisseProfileByPhone.mockResolvedValue(existingProfile);
    dbMock.linkTikisseProfileToSupabaseUser.mockResolvedValue({ ...existingProfile, supabaseUserId: "supabase-user-current" });

    const caller = appRouter.createCaller(context);
    await expect(caller.profiles.lookupSupabase({ phone: existingProfile.phone, accessToken: "t".repeat(80) })).resolves.toMatchObject({
      sessionToken: "session_tikisse_signee",
      profile: { phone: existingProfile.phone, role: "sender" },
    });
    expect(dbMock.linkTikisseProfileToSupabaseUser).toHaveBeenCalledWith(existingProfile.phone, "supabase-user-current");
  });

  it("propage une indisponibilité de profils au lieu de faire croire qu’aucun compte n’existe", async () => {
    dbMock.getTikisseProfileByPhone.mockRejectedValue(new Error("Le service des profils est temporairement indisponible."));
    const caller = appRouter.createCaller(context);
    await expect(caller.profiles.lookup({ phone: "+22676767676", otp: "730512" })).rejects.toThrow("Le service des profils est temporairement indisponible.");
  });
});
