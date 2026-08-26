import { afterEach, describe, expect, it, vi } from "vitest";
import { computeRoute, geocodeAddress, searchPlaces } from "../server/geography";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.GOOGLE_MAPS_BACKEND_API_KEY;
});

describe("services géographiques backend Tikis", () => {
  it("utilise la clé backend uniquement dans les en-têtes des requêtes Places", async () => {
    process.env.GOOGLE_MAPS_BACKEND_API_KEY = "backend-test-key";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ places: [{ id: "places/test", displayName: { text: "Maison du Peuple" }, formattedAddress: "Ouagadougou, Burkina Faso", location: { latitude: 12.3714, longitude: -1.5197 }, addressComponents: [{ longText: "Ouagadougou", types: ["locality"] }] }] })));
    global.fetch = fetchMock as typeof fetch;
    const result = await searchPlaces("Maison du Peuple");
    expect(result[0]?.latitude).toBe(12.3714);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ "X-Goog-Api-Key": "backend-test-key" });
  });

  it("retourne une distance et une durée depuis Routes API", async () => {
    process.env.GOOGLE_MAPS_BACKEND_API_KEY = "backend-test-key";
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ routes: [{ distanceMeters: 5400, duration: "721s" }] }))) as typeof fetch;
    const result = await computeRoute({ name: "Coris", district: "Koulouba", city: "Ouagadougou", latitude: 12.37, longitude: -1.52 }, { name: "Maison", district: "Ouaga 2000", city: "Ouagadougou", latitude: 12.35, longitude: -1.54 });
    expect(result).toEqual({ distanceKm: 5.4, durationMinutes: 12 });
  });

  it("assainit une adresse avant le géocodage backend", async () => {
    process.env.GOOGLE_MAPS_BACKEND_API_KEY = "backend-test-key";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [] })));
    global.fetch = fetchMock as typeof fetch;
    await geocodeAddress(" <Karpala> ");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("Karpala");
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("%3C");
  });
});
