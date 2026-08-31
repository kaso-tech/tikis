import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { favoriteToLocation, toPlacePayload } from "../lib/place-favorites";

const addressesScreen = readFileSync(join(process.cwd(), "app/(tabs)/addresses.tsx"), "utf8");

describe("ajout direct d’adresse", () => {
  it("conserve les coordonnées et les métadonnées utiles lors de la persistance", () => {
    const payload = toPlacePayload({
      name: "Maison du Peuple",
      district: "Koulouba",
      city: "Ouagadougou",
      latitude: 12.3714,
      longitude: -1.5197,
      mapboxId: "poi.123",
      formattedAddress: "Avenue Kwame Nkrumah, Ouagadougou",
      source: "retrieve",
    });

    expect(payload).toMatchObject({ latitude: 12.3714, longitude: -1.5197, mapboxId: "poi.123", source: "retrieve" });
    expect(favoriteToLocation({ place: {
      placeName: "Maison du Peuple",
      district: "Koulouba",
      city: "Ouagadougou",
      latitude: "12.3714",
      longitude: "-1.5197",
      googlePlaceId: null,
      mapboxPlaceId: "poi.123",
      formattedAddress: "Avenue Kwame Nkrumah, Ouagadougou",
      street: null,
      province: null,
      country: "Burkina Faso",
      provider: "mapbox",
      source: "retrieve",
      featureType: "poi",
      precision: "exact",
    } })).toMatchObject({ latitude: 12.3714, longitude: -1.5197, mapboxId: "poi.123", provider: "mapbox" });
  });

  it("ouvre le sélecteur puis demande un libellé avant de créer le favori", () => {
    expect(addressesScreen).toContain('target="address"');
    expect(addressesScreen).toContain("const savePlace = trpc.geography.savePlace.useMutation()");
    expect(addressesScreen).toContain("const addFavorite = trpc.geography.favorites.add.useMutation()");
    expect(addressesScreen).toContain("<SaveAddressDialog visible={Boolean(placeToSave)}");
    expect(addressesScreen).toContain("sanitizePlaceText(label, 80)");
  });
});
