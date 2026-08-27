import { afterEach, describe, expect, it, vi } from "vitest";
import { computeRoute, geocodeAddress, resolveMapboxPlace, reverseGeocodeLocation, searchPlaces } from "../server/geography";

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

  it("privilégie les suggestions Mapbox d’adresse, rue et quartier", async () => {
    process.env.MAPBOX_SECRET_ACCESS_TOKEN = "backend-test-token";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ suggestions: [{ mapbox_id: "address-1", name: "12 Avenue Kwame Nkrumah", full_address: "12 Avenue Kwame Nkrumah, Koulouba, Ouagadougou, Burkina Faso", place_formatted: "Ouagadougou, Burkina Faso", context: { neighborhood: { name: "Koulouba" }, place: { name: "Ouagadougou" }, country: { name: "Burkina Faso" } } }] })));
    global.fetch = fetchMock as typeof fetch;
    const result = await searchPlaces("Kwame Nkrumah");
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("types=address%2Cpoi%2Cstreet%2Cneighborhood%2Clocality%2Cplace");
    expect(result[0]).toMatchObject({ name: "12 Avenue Kwame Nkrumah", district: "Koulouba", city: "Ouagadougou", formattedAddress: "12 Avenue Kwame Nkrumah, Koulouba, Ouagadougou, Burkina Faso" });
  });

  it("restreint les suggestions Mapbox au pays du profil lorsque le code est valide", async () => {
    process.env.MAPBOX_SECRET_ACCESS_TOKEN = "backend-test-token";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ suggestions: [] })));
    global.fetch = fetchMock as typeof fetch;
    await searchPlaces("Abidjan", { latitude: 5.36, longitude: -4.01 }, "CI");
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("country")).toBe("CI");
    expect(url.searchParams.get("proximity")).toBe("-4.01,5.36");
  });

  it("ignore les codes pays non conformes et conserve le repli sans filtre", async () => {
    process.env.MAPBOX_SECRET_ACCESS_TOKEN = "backend-test-token";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ suggestions: [] })));
    global.fetch = fetchMock as typeof fetch;
    await searchPlaces("Ouagadougou", undefined, "BF<script>");
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("country=");
  });

  it("conserve les contextes Mapbox structurés lors de la résolution d’une suggestion", async () => {
    process.env.MAPBOX_SECRET_ACCESS_TOKEN = "backend-test-token";
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ features: [{ id: "address-1", geometry: { coordinates: [-1.5203, 12.3699] }, properties: { feature_type: "address", mapbox_id: "address-1", name: "12 Avenue Kwame Nkrumah", full_address: "12 Avenue Kwame Nkrumah", context: { neighborhood: { name: "Koulouba" }, place: { name: "Ouagadougou" }, region: { name: "Centre" }, country: { name: "Burkina Faso" } } } }] }))) as typeof fetch;
    const place = await resolveMapboxPlace("address-1", "session-1");
    expect(place).toMatchObject({ name: "12 Avenue Kwame Nkrumah", district: "Koulouba", city: "Ouagadougou", province: "Centre", country: "Burkina Faso", latitude: 12.3699, longitude: -1.5203 });
  });

  it("retient l’adresse la plus précise lors d’un appui sur la carte", async () => {
    process.env.MAPBOX_SECRET_ACCESS_TOKEN = "backend-test-token";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ features: [
      { id: "place-ouaga", geometry: { coordinates: [-1.52, 12.37] }, properties: { feature_type: "place", name: "Ouagadougou", context: { place: { name: "Ouagadougou" }, country: { name: "Burkina Faso" } } } },
      { id: "street-kwame", geometry: { coordinates: [-1.5202, 12.3698] }, properties: { feature_type: "street", name: "Avenue Kwame Nkrumah", full_address: "Avenue Kwame Nkrumah", context: { neighborhood: { name: "Koulouba" }, place: { name: "Ouagadougou" }, country: { name: "Burkina Faso" } } } },
    ] })));
    global.fetch = fetchMock as typeof fetch;
    const place = await reverseGeocodeLocation(12.3698, -1.5202);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("types=address%2Cstreet%2Cneighborhood%2Clocality%2Cplace");
    expect(place).toMatchObject({ name: "Avenue Kwame Nkrumah", district: "Koulouba", city: "Ouagadougou" });
  });
});
