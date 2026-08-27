import { describe, expect, it } from "vitest";
import { mergeRecentPlaces } from "../lib/recent-places-rules";
import type { LocationLabel } from "@/shared/tikis-domain";

function place(name: string, latitude: number, longitude: number): LocationLabel {
  return { name, district: "Centre", city: "Ouagadougou", latitude, longitude, provider: "mapbox", source: "retrieve", featureType: "poi", precision: "exact" };
}

describe("adresses récentes", () => {
  it("place le dernier choix en tête et supprime son ancien doublon", () => {
    const home = place("Maison", 12.37, -1.51);
    const office = place("Bureau", 12.38, -1.52);
    expect(mergeRecentPlaces([home, office], office)).toEqual([office, home]);
  });

  it("conserve au plus trois adresses récentes", () => {
    const places = [place("A", 1, 1), place("B", 2, 2), place("C", 3, 3)];
    expect(mergeRecentPlaces(places, place("D", 4, 4)).map((item) => item.name)).toEqual(["D", "A", "B"]);
  });
});
