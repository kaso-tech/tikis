import { describe, expect, it } from "vitest";
import { toPlacePayload } from "../lib/place-favorites";
import type { LocationLabel } from "../shared/tikis-domain";

const communityPoi: LocationLabel = {
  name: "Maison du Peuple",
  district: "Koulouba",
  city: "Ouagadougou",
  latitude: 12.3714,
  longitude: -1.5197,
  provider: "openstreetmap",
  source: "search",
  featureType: "poi",
  precision: "exact",
};

describe("toPlacePayload — propagation de la classification des lieux", () => {
  it("transmet featureType et precision quand ils sont connus (repli communautaire, hors resolve/reverse)", () => {
    // Régression : avant ce correctif, ces deux champs n'étaient jamais transmis au serveur, qui les
    // écrivait alors en dur à "unknown" (server/routers.ts, saveDeliveryPlace / geography.savePlace).
    // Un lieu comme « Maison du Peuple », sélectionné via le repli OpenStreetMap (jamais résolu via
    // resolve/reverse), perdait ainsi définitivement son statut de nom de lieu public dès la première
    // écriture en base — cassant l'exemple métier n°1 de la spec des lieux à toute relecture ultérieure.
    const payload = toPlacePayload(communityPoi);
    expect(payload.featureType).toBe("poi");
    expect(payload.precision).toBe("exact");
  });

  it("omet les champs quand la classification n'est pas connue, plutôt que d'envoyer une valeur factice", () => {
    const { featureType, precision, ...rest } = communityPoi;
    void featureType;
    void precision;
    const payload = toPlacePayload(rest as LocationLabel);
    expect(payload).not.toHaveProperty("featureType");
    expect(payload).not.toHaveProperty("precision");
  });
});
