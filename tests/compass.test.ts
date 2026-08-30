import { describe, expect, it } from "vitest";
import { bearingTo, compassRotationToTarget } from "../lib/compass";

describe("boussole de collecte", () => {
  const origin = { latitude: 0, longitude: 0 };

  it("calcule le cap géographique vers le point de collecte", () => {
    expect(bearingTo(origin, { latitude: 1, longitude: 0 })).toBe(0);
    expect(bearingTo(origin, { latitude: 0, longitude: 1 })).toBe(90);
  });

  it("compense instantanément l’orientation du téléphone", () => {
    expect(compassRotationToTarget(origin, { latitude: 0, longitude: 1 }, 0)).toBe(90);
    expect(compassRotationToTarget(origin, { latitude: 0, longitude: 1 }, 90)).toBe(0);
    expect(compassRotationToTarget(origin, { latitude: 1, longitude: 0 }, 270)).toBe(90);
  });
});
