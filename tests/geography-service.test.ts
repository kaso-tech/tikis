import { afterEach, describe, expect, it, vi } from "vitest";
import { computeRoute, geocodeAddress, searchPlaces } from "../server/geography";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.MAPBOX_SECRET_ACCESS_TOKEN;
});

describe("services géographiques backend Tikis", () => {
  it("utilise Mapbox Search via le backend sans exposer le jeton au client", async () => {
    process.env.MAPBOX_SECRET_ACCESS_TOKEN = "backend-test-token";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ suggestions: [{ mapbox_id: "dXJuOm1ieHBsYzpwbGFjZQ", name: "Maison du Peuple", full_address: "Ouagadougou", place_formatted: "Ouagadougou, Burkina Faso" }] })));
    global.fetch = fetchMock as typeof fetch;
    const result = await searchPlaces("Maison du Peuple");
    expect(result[0]?.mapboxId).toBe("dXJuOm1ieHBsYzpwbGFjZQ");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("searchbox/v1/suggest");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("access_token=backend-test-token");
  });

  it("retourne une distance et une durée depuis Mapbox Directions", async () => {
    process.env.MAPBOX_SECRET_ACCESS_TOKEN = "backend-test-token";
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ routes: [{ distance: 5400, duration: 721 }] }))) as typeof fetch;
    const result = await computeRoute({ name: "Coris", district: "Koulouba", city: "Ouagadougou", latitude: 12.37, longitude: -1.52 }, { name: "Maison", district: "Ouaga 2000", city: "Ouagadougou", latitude: 12.35, longitude: -1.54 });
    expect(result).toEqual({ distanceKm: 5.4, durationMinutes: 12 });
  });

  it("assainit une adresse avant le géocodage backend", async () => {
    process.env.MAPBOX_SECRET_ACCESS_TOKEN = "backend-test-token";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ features: [] })));
    global.fetch = fetchMock as typeof fetch;
    await geocodeAddress(" <Karpala> ");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("Karpala");
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("%3C");
  });
});
