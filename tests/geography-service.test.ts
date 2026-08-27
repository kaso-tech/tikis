import { afterEach, describe, expect, it, vi } from "vitest";
import { computeRoute, geocodeAddress, resetGeographicCachesForTests, resolveMapboxPlace, reverseGeocodeLocation, searchPlaces } from "../server/geography";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.MAPBOX_SECRET_ACCESS_TOKEN;
  resetGeographicCachesForTests();
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
    expect(result[0]).not.toHaveProperty("latitude");
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

  it("réutilise les mêmes suggestions récentes pour limiter les appels Mapbox", async () => {
    process.env.MAPBOX_SECRET_ACCESS_TOKEN = "backend-test-token";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ suggestions: [{ mapbox_id: "cache-1", name: "Bureau Tikis" }] })));
    global.fetch = fetchMock as typeof fetch;
    await searchPlaces("Bureau Tikis", undefined, "BF");
    await searchPlaces("Bureau Tikis", undefined, "BF");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("élargit volontairement une recherche de commerce vers un POI directement sélectionnable", async () => {
    process.env.MAPBOX_SECRET_ACCESS_TOKEN = "backend-test-token";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ suggestions: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ features: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ lat: "12.3712", lon: "-1.5201", name: "Alimentation Wend Panga", category: "shop", display_name: "Alimentation Wend Panga, Koulouba, Ouagadougou, Burkina Faso", address: { neighbourhood: "Koulouba", city: "Ouagadougou", state: "Centre", country: "Burkina Faso" } }])));
    global.fetch = fetchMock as typeof fetch;
    const result = await searchPlaces("Alimentation", { latitude: 12.3714, longitude: -1.5197 }, "BF", true);
    expect(result[0]).toMatchObject({ id: "openstreetmap:12.37120:-1.52010", name: "Alimentation Wend Panga", provider: "openstreetmap", directLocation: { latitude: 12.3712, longitude: -1.5201, featureType: "poi", precision: "exact" } });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("searchbox/v1/forward");
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("nominatim.openstreetmap.org/search");
  });

  it("ne consulte pas le repli communautaire pendant l’autocomplétion automatique", async () => {
    process.env.MAPBOX_SECRET_ACCESS_TOKEN = "backend-test-token";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ suggestions: [] })));
    global.fetch = fetchMock as typeof fetch;
    await searchPlaces("Alimentation", { latitude: 12.3714, longitude: -1.5197 }, "BF");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("conserve les contextes Mapbox structurés lors de la résolution d’une suggestion", async () => {
    process.env.MAPBOX_SECRET_ACCESS_TOKEN = "backend-test-token";
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ features: [{ id: "address-1", geometry: { coordinates: [-1.5203, 12.3699] }, properties: { feature_type: "address", mapbox_id: "address-1", name: "12 Avenue Kwame Nkrumah", full_address: "12 Avenue Kwame Nkrumah", context: { neighborhood: { name: "Koulouba" }, place: { name: "Ouagadougou" }, region: { name: "Centre" }, country: { name: "Burkina Faso" } } } }] }))) as typeof fetch;
    const place = await resolveMapboxPlace("address-1", "session-1");
    expect(place).toMatchObject({ name: "12 Avenue Kwame Nkrumah", district: "Koulouba", city: "Ouagadougou", province: "Centre", country: "Burkina Faso", latitude: 12.3699, longitude: -1.5203, provider: "mapbox", source: "retrieve", featureType: "address", precision: "exact" });
  });

  it("refuse la résolution d’un lieu retourné hors du pays du profil", async () => {
    process.env.MAPBOX_SECRET_ACCESS_TOKEN = "backend-test-token";
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ features: [{ id: "cross-border", geometry: { coordinates: [-1.52, 12.37] }, properties: { feature_type: "poi", mapbox_id: "cross-border", name: "Lieu frontalier", context: { place: { name: "Ouagadougou" }, country: { name: "Burkina Faso" } } } }] }))) as typeof fetch;
    await expect(resolveMapboxPlace("cross-border", "session-1", "CI")).rejects.toThrow("hors du pays");
  });

  it("retient l’adresse la plus précise lors d’un appui sur la carte", async () => {
    process.env.MAPBOX_SECRET_ACCESS_TOKEN = "backend-test-token";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ features: [
      { id: "place-ouaga", geometry: { coordinates: [-1.62, 12.47] }, properties: { feature_type: "place", name: "Ouagadougou", context: { place: { name: "Ouagadougou" }, country: { name: "Burkina Faso" } } } },
      { id: "street-kwame", geometry: { coordinates: [-1.6202, 12.4698] }, properties: { feature_type: "street", name: "Avenue Kwame Nkrumah", full_address: "Avenue Kwame Nkrumah", context: { neighborhood: { name: "Koulouba" }, place: { name: "Ouagadougou" }, country: { name: "Burkina Faso" } } } },
    ] })));
    global.fetch = fetchMock as typeof fetch;
    const place = await reverseGeocodeLocation(12.4698, -1.6202);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("types=address%2Cstreet%2Cneighborhood%2Clocality%2Cplace");
    expect(place).toMatchObject({ name: "Avenue Kwame Nkrumah", district: "Koulouba", city: "Ouagadougou" });
  });

  it("complète une sélection cartographique réduite à une ville par une adresse communautaire plus précise", async () => {
    process.env.MAPBOX_SECRET_ACCESS_TOKEN = "backend-test-token";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ features: [{ id: "place-ouaga", geometry: { coordinates: [-1.687432, 12.534921] }, properties: { feature_type: "place", name: "Ouagadougou", context: { place: { name: "Ouagadougou" }, country: { name: "Burkina Faso" } } } }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ lat: "12.534921", lon: "-1.687432", name: "Alimentation Wend Panga", category: "shop", display_name: "Alimentation Wend Panga, Rue 25.02, Koulouba, Ouagadougou, Burkina Faso", address: { road: "Rue 25.02", neighbourhood: "Koulouba", city: "Ouagadougou", country: "Burkina Faso" } })));
    global.fetch = fetchMock as typeof fetch;
    const place = await reverseGeocodeLocation(12.534921, -1.687432, "BF");
    expect(place).toMatchObject({ name: "Alimentation Wend Panga", street: "Rue 25.02", district: "Koulouba", city: "Ouagadougou", provider: "openstreetmap", source: "search", precision: "exact" });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/reverse");
  });
});
