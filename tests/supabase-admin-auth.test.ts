import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `ensureSupabaseRealtimeSession` parle à trois endpoints Supabase Admin via `fetch` brut (jamais
// le SDK côté serveur, cf. server/supabase-realtime.ts) et à `server/db` pour lire/lier le profil.
// Les deux sont mockés : ce test vérifie l'enchaînement (créer si absent, poser un mot de passe à
// usage unique, échanger contre une session), pas une vraie infrastructure Supabase.
const dbMock = vi.hoisted(() => ({
  getTikisProfileByPhone: vi.fn(),
  linkTikisProfileToSupabaseUser: vi.fn(),
}));

vi.mock("../server/db", () => dbMock);

import { ensureSupabaseRealtimeSession } from "../server/supabase-admin-auth";

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  dbMock.getTikisProfileByPhone.mockReset();
  dbMock.linkTikisProfileToSupabaseUser.mockReset();
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe("pont de session Supabase Realtime", () => {
  it("renvoie null sans tenter le moindre appel réseau quand Supabase n'est pas configuré", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const fetchMock = vi.fn();
    global.fetch = fetchMock as typeof fetch;
    const session = await ensureSupabaseRealtimeSession("+22677777777");
    expect(session).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renvoie null quand le profil Tikis n'existe pas", async () => {
    dbMock.getTikisProfileByPhone.mockResolvedValue(null);
    const fetchMock = vi.fn();
    global.fetch = fetchMock as typeof fetch;
    const session = await ensureSupabaseRealtimeSession("+22677777777");
    expect(session).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("crée et lie un utilisateur Supabase quand le profil n'en a pas encore, puis pose un mot de passe et se connecte", async () => {
    dbMock.getTikisProfileByPhone.mockResolvedValue({ phone: "+22677777777", supabaseUserId: null });
    dbMock.linkTikisProfileToSupabaseUser.mockResolvedValue(undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "user-123" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "access-abc", refresh_token: "refresh-xyz" }), { status: 200 }));
    global.fetch = fetchMock as typeof fetch;

    const session = await ensureSupabaseRealtimeSession("+22677777777");

    expect(session).toEqual({ accessToken: "access-abc", refreshToken: "refresh-xyz" });
    expect(dbMock.linkTikisProfileToSupabaseUser).toHaveBeenCalledWith("+22677777777", "user-123");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/auth/v1/admin/users");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/auth/v1/admin/users/user-123");
    expect(String(fetchMock.mock.calls[2][0])).toContain("grant_type=password");
  });

  it("réutilise l'utilisateur Supabase déjà lié sans recréer de compte", async () => {
    dbMock.getTikisProfileByPhone.mockResolvedValue({ phone: "+22677777777", supabaseUserId: "user-existing" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "a", refresh_token: "r" }), { status: 200 }));
    global.fetch = fetchMock as typeof fetch;

    const session = await ensureSupabaseRealtimeSession("+22677777777");

    expect(session).toEqual({ accessToken: "a", refreshToken: "r" });
    expect(dbMock.linkTikisProfileToSupabaseUser).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/auth/v1/admin/users/user-existing");
  });

  it("abandonne proprement si la création de l'utilisateur échoue, sans jamais lancer d'exception", async () => {
    dbMock.getTikisProfileByPhone.mockResolvedValue({ phone: "+22677777777", supabaseUserId: null });
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 500 }));
    global.fetch = fetchMock as typeof fetch;

    const session = await ensureSupabaseRealtimeSession("+22677777777");

    expect(session).toBeNull();
    expect(dbMock.linkTikisProfileToSupabaseUser).not.toHaveBeenCalled();
  });

  it("abandonne proprement si la connexion par mot de passe échoue", async () => {
    dbMock.getTikisProfileByPhone.mockResolvedValue({ phone: "+22677777777", supabaseUserId: "user-existing" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 400 }));
    global.fetch = fetchMock as typeof fetch;

    const session = await ensureSupabaseRealtimeSession("+22677777777");

    expect(session).toBeNull();
  });

  it("ne laisse jamais une exception réseau remonter à l'appelant", async () => {
    dbMock.getTikisProfileByPhone.mockRejectedValue(new Error("connexion base indisponible"));
    const session = await ensureSupabaseRealtimeSession("+22677777777");
    expect(session).toBeNull();
  });
});
