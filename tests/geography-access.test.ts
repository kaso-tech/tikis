import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../server/_core/context";

// Le middleware d'authentification (`requireTikisProfile`) et le rate-limit géographique
// (`enforceGeographyRateLimit`) appellent tous deux `server/db` avant que `geography.search`
// ne soit atteint. Sans ce mock, le second test touchait une vraie connexion base de
// données — absente de cet environnement de test — et échouait sur « Le service des
// profils est temporairement indisponible » plutôt que sur l'assertion qu'il porte
// réellement. La dérivation du pays elle-même (`sessionCountryCode`) est pure : rien dans
// ce test n'a jamais eu besoin d'infrastructure réelle.
const dbMock = vi.hoisted(() => ({
  getTikisProfileByPhone: vi.fn(),
  checkDistributedRateLimit: vi.fn(),
}));

vi.mock("../server/db", () => dbMock);

import { appRouter } from "../server/routers";
import { resetGeographicCachesForTests } from "../server/geography";

const originalFetch = global.fetch;

function contextFor(phone: string | null): TrpcContext {
  return {
    user: null,
    tikisProfilePhone: phone,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => undefined } as unknown as TrpcContext["res"],
  };
}

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.MAPBOX_SECRET_ACCESS_TOKEN;
  resetGeographicCachesForTests();
});

describe("accès géographique Tikis", () => {
  it("refuse toute recherche sans session Tikis signée", async () => {
    const caller = appRouter.createCaller(contextFor(null));
    await expect(caller.geography.search({ query: "Ouagadougou" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("impose le pays déduit du profil même si le client en transmet un autre", async () => {
    dbMock.getTikisProfileByPhone.mockResolvedValue({ phone: "+22677777777", accountType: "sender", status: "active", deletedAt: null });
    dbMock.checkDistributedRateLimit.mockResolvedValue(true);
    process.env.MAPBOX_SECRET_ACCESS_TOKEN = "backend-test-token";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ suggestions: [] })));
    global.fetch = fetchMock as typeof fetch;
    const caller = appRouter.createCaller(contextFor("+22677777777"));
    await caller.geography.search({ query: "Ouagadougou", countryCode: "FR" });
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get("country")).toBe("BF");
  });
});
