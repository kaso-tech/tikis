import { beforeEach, describe, expect, it } from "vitest";
import { clearRouteCache, readCachedRoute, ROUTE_CACHE_LIMIT, writeCachedRoute } from "../lib/route-cache";

const A = { latitude: 12.3714, longitude: -1.5197 };
const B = { latitude: 12.38, longitude: -1.51 };

beforeEach(() => {
  clearRouteCache();
});

describe("le cache d'itinéraires", () => {
  it("rend ce qui a été mémorisé pour la même clé", () => {
    writeCachedRoute("a>b", [A, B]);
    expect(readCachedRoute("a>b")).toEqual([A, B]);
  });

  it("ne connaît rien d'une clé jamais écrite", () => {
    expect(readCachedRoute("jamais-vu")).toBeNull();
  });

  it("un tracé d'un seul point n'est pas mémorisé : un échec ne doit jamais se faire passer pour un itinéraire", () => {
    writeCachedRoute("a>b", [A]);
    expect(readCachedRoute("a>b")).toBeNull();
  });

  it("un tracé vide n'est pas mémorisé non plus", () => {
    writeCachedRoute("a>b", []);
    expect(readCachedRoute("a>b")).toBeNull();
  });

  it("survit à plusieurs lectures", () => {
    writeCachedRoute("a>b", [A, B]);
    readCachedRoute("a>b");
    expect(readCachedRoute("a>b")).toEqual([A, B]);
  });

  it("oublie les entrées les plus anciennes au-delà de la limite", () => {
    for (let i = 0; i < ROUTE_CACHE_LIMIT + 5; i += 1) {
      writeCachedRoute(`key-${i}`, [A, { latitude: A.latitude + i, longitude: A.longitude }]);
    }
    // Les cinq premières ont été évincées, les plus récentes tiennent toujours.
    expect(readCachedRoute("key-0")).toBeNull();
    expect(readCachedRoute(`key-${ROUTE_CACHE_LIMIT + 4}`)).not.toBeNull();
  });

  it("relire une entrée la protège de l'éviction suivante", () => {
    writeCachedRoute("garder", [A, B]);
    for (let i = 0; i < ROUTE_CACHE_LIMIT - 1; i += 1) {
      writeCachedRoute(`autre-${i}`, [A, { latitude: A.latitude + i, longitude: A.longitude }]);
    }
    // "garder" est relu : il repasse en queue, la prochaine écriture n'évince pas elle.
    expect(readCachedRoute("garder")).toEqual([A, B]);
    writeCachedRoute("declencheur", [A, B]);
    expect(readCachedRoute("garder")).toEqual([A, B]);
  });
});
