import { describe, expect, it } from "vitest";
import { computeDaysRemaining } from "../server/_test-helpers/deletion-flow";

describe("flux de suppression de compte (vue serveur)", () => {
  it("calcule correctement le nombre de jours restants avant finalisation", () => {
    const scheduled = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString();
    expect(computeDaysRemaining(scheduled)).toBe(15);
  });

  it("retourne 0 si la date est dépassée", () => {
    const scheduled = new Date(Date.now() - 1000).toISOString();
    expect(computeDaysRemaining(scheduled)).toBe(0);
  });

  it("retourne 0 si aucune date n'est fournie", () => {
    expect(computeDaysRemaining(undefined)).toBe(0);
  });

  it("la durée totale de grâce est exactement 30 jours", () => {
    const requested = new Date("2026-09-01T10:00:00.000Z");
    const scheduled = new Date(requested.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(computeDaysRemaining(scheduled.toISOString(), requested.getTime())).toBe(30);
  });
});
