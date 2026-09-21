import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const markers = read("components/tikis/map-markers.tsx");
const surfaces = {
  "accueil (natif)": read("components/tikis/screens/home-screen.native.tsx"),
  "accueil (web)": read("components/tikis/screens/home-screen.web.tsx"),
  "fiche et suivi (natif)": read("components/tikis/delivery-route-map.native.tsx"),
  "fiche et suivi (web)": read("components/tikis/delivery-route-map.web.tsx"),
};

describe("marqueurs de carte", () => {
  it("donne à chaque rôle un dessin qui le nomme : colis, damier d'arrivée, moto", () => {
    expect(markers).toContain('icon="inventory-2"');
    expect(markers).toContain('icon="sports-score"');
    expect(markers).toContain('name="two-wheeler"');
  });

  it("pose les extrémités par leur pointe et le livreur par son centre", () => {
    expect(markers).toContain("export const PIN_ANCHOR = { x: 0.5, y: 1 }");
    expect(markers).toContain("export const CHIP_ANCHOR = { x: 0.5, y: 0.5 }");
  });

  // Les deux décalages se cumulent : le marqueur de collecte s'en était
  // retrouvé décalé du point de collecte. Un seul des deux, jamais les deux.
  it.each(Object.entries(surfaces))("%s ancre ses marqueurs par `anchor` seul", (_name, source) => {
    expect(source).not.toMatch(/centerOffset=/);
  });

  it("ne fait pas pivoter la moto avec le cap, mais un ergot autour d'elle", () => {
    expect(markers).toContain("driverHeadingPip");
    expect(markers).not.toMatch(/driverChip[^}]*rotate/);
  });

  it.each(Object.entries(surfaces))("%s emprunte les marqueurs partagés plutôt que les siens", (_name, source) => {
    expect(source).toContain('from "@/components/tikis/map-markers"');
    expect(source).toContain("<PickupMarker");
    expect(source).toContain("<DropoffMarker");
    expect(source).toContain("<DriverMarker");
  });

  it.each(Object.entries(surfaces))("%s ne redessine plus de marqueur à la main", (_name, source) => {
    expect(source).not.toMatch(/name="location-on"/);
    expect(source).not.toMatch(/name="trip-origin"/);
  });
});
