import { describe, expect, it } from "vitest";
import { coordinateAtStep, remainingMinutes, routeProgress, SIMULATED_ROUTE, trackingEventAtStep } from "../lib/gps-simulator";

describe("suivi GPS simulé Tikis", () => {
  it("borne la progression entre le départ et l’arrivée", () => {
    expect(routeProgress(-2)).toBe(0);
    expect(routeProgress(SIMULATED_ROUTE.length - 1)).toBe(100);
    expect(routeProgress(3)).toBe(43);
  });

  it("retourne les coordonnées de route et réduit l’ETA avec la progression", () => {
    expect(coordinateAtStep(0)).toEqual(SIMULATED_ROUTE[0]);
    expect(coordinateAtStep(999)).toEqual(SIMULATED_ROUTE[SIMULATED_ROUTE.length - 1]);
    expect(remainingMinutes(0)).toBeGreaterThan(remainingMinutes(5));
  });

  it("déclenche une alerte à l’approche puis une alerte d’arrivée", () => {
    expect(trackingEventAtStep(5)).toBeNull();
    expect(trackingEventAtStep(6)?.type).toBe("nearby");
    expect(trackingEventAtStep(7)?.type).toBe("arrived");
  });
});
