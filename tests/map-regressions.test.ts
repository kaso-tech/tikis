import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const home = read("components/tikis/screens/home-screen.native.tsx");
const routeMap = read("components/tikis/delivery-route-map.native.tsx");
const detail = read("app/delivery/[id].tsx");
const hooks = read("hooks/use-route-coordinates.ts");
const sheet = read("components/tikis/candidates-sheet.tsx");

const surfaces = { accueil: home, "fiche de livraison": routeMap };

describe("les calques de la carte ont une identité stable", () => {
  it.each(Object.entries(surfaces))("sur %s, chaque marqueur et chaque tracé porte une clé", (_name, source) => {
    // Sans clé, React réconcilie par position : quand le marqueur de position
    // s'efface à l'arrivée d'une course, `react-native-maps` retire côté natif
    // celui qui occupe l'index libéré — le point de collecte.
    const layers = source.match(/<(Marker|Polyline)\b/g) ?? [];
    const keyed = source.match(/<(Marker|Polyline) key=/g) ?? [];
    expect(layers.length).toBeGreaterThan(0);
    expect(keyed.length).toBe(layers.length);
  });

  it.each(Object.entries(surfaces))("sur %s, le rang de dessin est explicite", (_name, source) => {
    // « The order of overlays with the same z-index is arbitrary », dit la
    // documentation de react-native-maps.
    const layers = source.match(/<(Marker|Polyline)\b/g) ?? [];
    const ranked = source.match(/zIndex=\{MAP_Z\./g) ?? [];
    expect(ranked.length).toBe(layers.length);
  });
});

describe("l’itinéraire survit à un retour sur l’écran", () => {
  it("la fiche de livraison ne recalcule plus sur l’identité de l’objet", () => {
    // `useEffect(..., [delivery])` : une revalidation rendait un objet neuf,
    // vidait le tracé, et la carte retombait sur la ligne droite.
    expect(detail).toContain("useRouteCoordinates(delivery?.pickup, delivery?.dropoff)");
    expect(detail).not.toContain("setRouteCoordinates");
  });

  it("une ligne droite de repli ne se fait plus passer pour un vrai trajet", () => {
    // La page fabriquait elle-même un segment de deux points et le passait à la
    // carte, qui y voyait un itinéraire abouti et le traçait en trait plein.
    // Elle ne transmet plus que le vrai tracé — ou rien, et c'est la carte qui
    // dessine son repli, en pointillé.
    expect(detail).toContain("coordinates={routeCoordinates}");
    expect(detail).not.toContain("fallbackRouteCoordinates");
    expect(routeMap).toContain("coordinates.length < 2");
    expect(routeMap).toContain("lineDashPattern={isFallback");
  });

  it("le hook garde son tracé tant que la géométrie ne bouge pas", () => {
    expect(hooks).toContain("if (requestedKey.current === key) return;");
    expect(hooks).toContain("routeGeometryKey");
  });

  it("l’accueil passe par le même hook, sans effet maison", () => {
    expect(home).toContain("useRouteCoordinates(pickup, dropoff)");
    expect(home).not.toContain("setRouteCoordinates");
    expect(home).not.toContain("setApproachCoordinates");
  });
});

describe("le livreur voit ce qui le sépare du point de collecte", () => {
  it("sur l’accueil, l’approche n’attend plus que la course soit active", () => {
    expect(home).toContain('const showsApproach = role === "driver" ? isPickupPending(selectedDeliveryStatus) : selectedDeliveryStatus === "active";');
    // Le cadrage suit le même drapeau, sinon la ligne verte sortirait de l'écran.
    expect(home).toContain("driver && showsApproachRef.current");
  });

  it("sur la fiche de livraison, elle est tracée et sa position affichée", () => {
    expect(detail).toContain("useApproachRoute({");
    expect(detail).toContain("approachCoordinates={approachCoordinates}");
    expect(detail).toContain("driverPosition={isDriver ? driverLocation.location : null}");
  });
});

describe("la feuille des candidats n’anime plus sa hauteur en natif", () => {
  it("l’entrée reste sur le pilote JS", () => {
    // Un même nœud de style ne peut pas être à cheval sur les deux pilotes :
    // `translateY` en natif y forçait `height`, que le module natif refuse.
    const entry = sheet.slice(sheet.indexOf("Animated.spring(enter"), sheet.indexOf("Animated.spring(enter") + 120);
    expect(entry).toContain("useNativeDriver: false");
    expect(sheet).not.toMatch(/useNativeDriver: true/);
  });
});
