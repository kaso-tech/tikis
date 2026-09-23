import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bridgeRouteEndpoints, computeRoute, resetGeographicCachesForTests, ROUTE_ENDPOINT_TOLERANCE_METERS } from "../server/geography";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.MAPBOX_SECRET_ACCESS_TOKEN;
  resetGeographicCachesForTests();
  vi.restoreAllMocks();
});

// Un livreur à Koudougou, une course dont la collecte est à Tanghin, au nord d'Ouagadougou.
const livreur = { name: "Position du livreur", district: "", city: "", latitude: 12.2526, longitude: -2.3627 };
const collecte = { name: "Tanghin", district: "Tanghin", city: "Ouagadougou", latitude: 12.3894, longitude: -1.5197 };
// Là où Mapbox a accroché l'arrivée : la route praticable la plus proche, en plein centre, à 2 km.
const centreVille = [-1.5197, 12.3714];

describe("l'approche du livreur rejoint le point de collecte", () => {
  it("raccorde le tracé à l'épingle quand Mapbox l'arrête sur une route plus proche", async () => {
    process.env.MAPBOX_SECRET_ACCESS_TOKEN = "backend-test-token";
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      routes: [{ distance: 98_000, duration: 5_400, geometry: { coordinates: [[livreur.longitude, livreur.latitude], [-2.0, 12.3], centreVille] } }],
    }))) as typeof fetch;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const route = await computeRoute(livreur, collecte);

    // Le dernier point est l'épingle, plus le centre-ville.
    expect(route.coordinates.at(-1)).toEqual({ latitude: collecte.latitude, longitude: collecte.longitude });
    expect(route.coordinates.at(-2)).toEqual({ latitude: centreVille[1], longitude: centreVille[0] });
    // La distance routière, base du prix, reste celle de Mapbox.
    expect(route.distanceKm).toBe(98);
    // L'écart est signalé, sans jamais écrire de coordonnées dans les journaux.
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls[0]);
    expect(logged).toContain("arriveeM");
    expect(logged).not.toContain("12.3894");
  });

  it("ne touche pas un tracé qui arrive déjà au point, à quelques mètres près", () => {
    const tracé = [{ latitude: 12.2526, longitude: -2.3627 }, { latitude: 12.38938, longitude: -1.51972 }];
    const result = bridgeRouteEndpoints(tracé, livreur, collecte);
    expect(result.endGapMeters).toBeLessThanOrEqual(ROUTE_ENDPOINT_TOLERANCE_METERS);
    expect(result.coordinates).toEqual(tracé);
  });

  it("raccorde aussi le départ, quand le livreur est loin de toute route", () => {
    const tracé = [{ latitude: 12.2600, longitude: -2.3627 }, { latitude: collecte.latitude, longitude: collecte.longitude }];
    const result = bridgeRouteEndpoints(tracé, livreur, collecte);
    expect(result.startGapMeters).toBeGreaterThan(800);
    expect(result.coordinates[0]).toEqual({ latitude: livreur.latitude, longitude: livreur.longitude });
    expect(result.coordinates).toHaveLength(3);
  });

  it("laisse vide un tracé vide : c'est au client de tracer sa ligne droite de repli", () => {
    expect(bridgeRouteEndpoints([], livreur, collecte).coordinates).toEqual([]);
  });
});

describe("le livreur voit sa propre position sur l'accueil", () => {
  it("dès qu'elle est connue, et pas seulement une fois la course active", () => {
    // La ligne d'approche est tracée dès qu'une course attend sa collecte ; le marqueur n'apparaissait
    // qu'une fois la course active : la ligne partait d'un point que rien ne marquait.
    const native = read("components/tikis/screens/home-screen.native.tsx");
    expect(native).toContain('const showsDriverMarker = Boolean(driverPosition) && (role === "driver" || selectedDeliveryStatus === "active");');
    expect(native).toContain("{showsDriverMarker && driverPosition ? (");
    expect(native).not.toContain("hasDriver");
  });

  it("sur l'accueil web aussi, avec la même règle que l'accueil natif", () => {
    const web = read("components/tikis/screens/home-screen.web.tsx");
    expect(web).toContain('const showsApproach = role === "driver" ? isPickupPending(selected?.status) : selected?.status === "active";');
    expect(web).toContain("if (!pickup || !driverPosition || !showsApproach) return null;");
    expect(web).not.toContain("hasDriver");
  });
});
