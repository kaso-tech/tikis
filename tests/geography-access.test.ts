import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";
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
    process.env.MAPBOX_SECRET_ACCESS_TOKEN = "backend-test-token";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ suggestions: [] })));
    global.fetch = fetchMock as typeof fetch;
    const caller = appRouter.createCaller(contextFor("+22670000000"));
    await caller.geography.search({ query: "Ouagadougou", countryCode: "FR" });
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get("country")).toBe("BF");
  });
});
