import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { approximateCoordinate, concealPlaceForDriver } from "../server/_test-helpers/delivery-visibility";
import { formatDeliveryDetailPlace, formatListRouteParts, geodesicDistanceKm } from "../lib/geo-rules";
import type { LocationLabel } from "../shared/tikis-domain";

const karpala: LocationLabel = {
  name: "Villa 32, chez Awa",
  district: "Karpala",
  city: "Ouagadougou",
  street: "Rue 14.38",
  latitude: 12.3117,
  longitude: -1.4763,
  googlePlaceId: "place-karpala",
  formattedAddress: "Villa 32, Rue 14.38, Karpala, Ouagadougou",
  featureType: "address",
  precision: "exact",
};

const ouaga2000: LocationLabel = {
  name: "Immeuble Faso, 4e étage",
  district: "Ouaga 2000",
  city: "Ouagadougou",
  street: "Avenue Mouammar Kadhafi",
  latitude: 12.3021,
  longitude: -1.4938,
  featureType: "address",
  precision: "exact",
};

describe("ce qu'un livreur voit d'une course non attribuée", () => {
  it("annonce le quartier plutôt que la ville répétée", () => {
    const route = formatListRouteParts(concealPlaceForDriver(karpala), concealPlaceForDriver(ouaga2000));
    expect(route).toEqual({ pickup: "Karpala", dropoff: "Ouaga 2000", sameCity: true });
  });

  it("ne laisse filtrer ni la porte, ni la rue, ni l'identifiant du lieu", () => {
    const concealed = concealPlaceForDriver(karpala);
    expect(concealed.name).toBe("Karpala");
    expect(concealed.street).toBeUndefined();
    expect(concealed.googlePlaceId).toBeUndefined();
    expect(concealed.formattedAddress).toBe("Karpala, Ouagadougou");
    expect(JSON.stringify(concealed)).not.toContain("Awa");
    expect(JSON.stringify(concealed)).not.toContain("14.38");
  });

  it("garde le nom d'un lieu public, qui est un point de rendez-vous et non un domicile", () => {
    const maisonDuPeuple: LocationLabel = {
      name: "Maison du Peuple",
      district: "Koulouba",
      city: "Ouagadougou",
      latitude: 12.3686,
      longitude: -1.5275,
      featureType: "poi",
      precision: "exact",
    };
    const route = formatListRouteParts(concealPlaceForDriver(maisonDuPeuple), concealPlaceForDriver(ouaga2000));
    expect(route.pickup).toBe("Maison du Peuple");
    expect(route.dropoff).toBe("Ouaga 2000");
  });

  it("garde la ville quand le quartier est inconnu, sans inventer de quartier", () => {
    const sansQuartier = concealPlaceForDriver({ ...karpala, district: "" });
    expect(formatListRouteParts(sansQuartier, sansQuartier).pickup).toBe("Ouagadougou");
  });

  it("arrondit la position au kilomètre : assez pour cacher la porte, pas pour déplacer la course", () => {
    const concealed = concealPlaceForDriver(karpala);
    expect(concealed.latitude).toBe(12.31);
    expect(concealed.longitude).toBe(-1.48);
    expect(concealed.precision).toBe("area");
    // Le pas au dixième de degré déportait la collecte de plusieurs kilomètres,
    // et la distance « à X km de vous » avec elle.
    expect(geodesicDistanceKm(karpala, concealed)).toBeLessThan(1.5);
  });

  it("n'introduit pas d'artefact de virgule flottante dans les coordonnées", () => {
    // 12.31 * 1 s'écrit 12.310000000000002 sans le repli sur deux décimales,
    // et la coordonnée « arrondie » partait au serveur avec quinze chiffres.
    for (let step = -2000; step <= 2000; step += 7) {
      const rounded = approximateCoordinate(step * 0.00037);
      expect(String(rounded)).toMatch(/^-?\d+(\.\d{1,2})?$/);
    }
  });

  it("détaille le quartier puis la ville dans la fiche du livreur", () => {
    const place = formatDeliveryDetailPlace(concealPlaceForDriver(karpala));
    expect(place.title).toBe("Karpala");
    expect(place.subtitle).toBe("Ouagadougou");
  });

  it("laisse le serveur masquer par cette seule fonction", () => {
    const routers = readFileSync(join(process.cwd(), "server/routers.ts"), "utf8");
    expect(routers).toContain("concealPlaceForDriver(delivery.pickup)");
    expect(routers).toContain("concealPlaceForDriver(delivery.dropoff)");
    // L'ancien masquage vidait le quartier sur place, hors de toute fonction testable.
    expect(routers).not.toContain('district: ""');
  });
});
