import { describe, expect, it } from "vitest";
import {
  APPROACH_MAX_AGE_MS,
  APPROACH_MIN_MOVE_METERS,
  isUsablePoint,
  pointKey,
  routeGeometryKey,
  shouldRefreshApproach,
} from "../lib/route-refresh";

const OUAGA = { latitude: 12.3714, longitude: -1.5197 };

/** Un point à `meters` mètres au nord de `from`. */
function north(from: { latitude: number; longitude: number }, meters: number) {
  return { latitude: from.latitude + meters / 111_320, longitude: from.longitude };
}

describe("la clé d'un itinéraire", () => {
  it("ne dépend que de la géométrie, pas de l'objet qui la porte", () => {
    // C'est tout l'enjeu : une revalidation tRPC rend un objet neuf pour le
    // même trajet, et l'écran ne doit pas y voir un nouvel itinéraire.
    const a = routeGeometryKey({ ...OUAGA }, { latitude: 12.4, longitude: -1.5 });
    const b = routeGeometryKey({ ...OUAGA }, { latitude: 12.4, longitude: -1.5 });
    expect(a).toBe(b);
  });

  it("change dès qu'une extrémité bouge vraiment", () => {
    const a = routeGeometryKey(OUAGA, { latitude: 12.4, longitude: -1.5 });
    const b = routeGeometryKey(OUAGA, { latitude: 12.5, longitude: -1.5 });
    expect(a).not.toBe(b);
  });

  it("absorbe une décimale de plus au retour de la base", () => {
    expect(pointKey({ latitude: 12.371400001, longitude: -1.519700004 })).toBe(pointKey(OUAGA));
  });

  it("distingue un aller d'un retour", () => {
    const there = routeGeometryKey(OUAGA, { latitude: 12.4, longitude: -1.5 });
    const back = routeGeometryKey({ latitude: 12.4, longitude: -1.5 }, OUAGA);
    expect(there).not.toBe(back);
  });
});

describe("les points exploitables", () => {
  it.each([
    [null, false],
    [undefined, false],
    [{ latitude: Number.NaN, longitude: -1.5 }, false],
    [{ latitude: 12.37, longitude: Number.POSITIVE_INFINITY }, false],
    [OUAGA, true],
    [{ latitude: 0, longitude: 0 }, true],
  ])("%s → %s", (point, expected) => {
    expect(isUsablePoint(point as never)).toBe(expected);
  });
});

describe("le rafraîchissement de l'approche", () => {
  const now = 1_700_000_000_000;

  it("se fait au premier appel", () => {
    expect(shouldRefreshApproach(null, OUAGA, now)).toBe(true);
  });

  it("ne se fait pas pour un livreur qui n'a quasiment pas bougé", () => {
    const anchor = { ...OUAGA, at: now };
    expect(shouldRefreshApproach(anchor, north(OUAGA, 20), now + 2_000)).toBe(false);
  });

  it("se fait dès que le livreur a franchi le seuil de distance", () => {
    const anchor = { ...OUAGA, at: now };
    expect(shouldRefreshApproach(anchor, north(OUAGA, APPROACH_MIN_MOVE_METERS + 10), now + 2_000)).toBe(true);
  });

  it("se fait aussi à l'arrêt quand le tracé date", () => {
    // Un livreur immobile dans un embouteillage : l'itinéraire recalculé peut
    // avoir changé même si lui n'a pas bougé.
    const anchor = { ...OUAGA, at: now };
    expect(shouldRefreshApproach(anchor, OUAGA, now + APPROACH_MAX_AGE_MS)).toBe(true);
  });
});
