import { describe, expect, it } from "vitest";
import {
  arrivalClockTime,
  buildMilestones,
  deliveryReference,
  describeSignalFreshness,
  formatClockTime,
  formatCountdown,
  milestoneIndex,
  trackingStatusLabel,
} from "../lib/live-tracking-format";

const NOW = new Date("2026-03-04T14:23:00").getTime();

describe("describeSignalFreshness", () => {
  it("dit « en attente » tant qu'aucune position n'est arrivée", () => {
    expect(describeSignalFreshness(null, NOW)).toEqual({ state: "none", label: "Signal en attente", age: "" });
    expect(describeSignalFreshness(undefined, NOW).state).toBe("none");
  });

  it("reste en direct sous une minute, en secondes", () => {
    const fresh = describeSignalFreshness(new Date(NOW - 4_000).toISOString(), NOW);
    expect(fresh.state).toBe("live");
    expect(fresh.label).toBe("En direct");
    expect(fresh.age).toBe("il y a 4 s");
  });

  it("bascule en signal faible au-delà d'une minute", () => {
    const stale = describeSignalFreshness(new Date(NOW - 95_000).toISOString(), NOW);
    expect(stale.state).toBe("weak");
    expect(stale.label).toBe("Signal faible");
    expect(stale.age).toBe("il y a 2 min");
  });

  it("ne renvoie jamais un âge négatif si l'horloge du téléphone avance", () => {
    expect(describeSignalFreshness(new Date(NOW + 5_000).toISOString(), NOW).age).toBe("il y a 0 s");
  });

  it("ignore une date illisible", () => {
    expect(describeSignalFreshness("pas-une-date", NOW).state).toBe("none");
  });
});

describe("heure d'arrivée", () => {
  it("formate en horloge 24 h sur deux chiffres", () => {
    expect(formatClockTime(new Date("2026-03-04T09:05:00"))).toBe("09:05");
  });

  it("ajoute l'ETA à maintenant", () => {
    expect(arrivalClockTime(9, NOW)).toBe("14:32");
  });

  it("n'invente pas d'heure sans ETA", () => {
    expect(arrivalClockTime(0, NOW)).toBeNull();
    expect(arrivalClockTime(Number.NaN, NOW)).toBeNull();
  });

  it("écrit le compte à rebours en minutes puis en heures", () => {
    expect(formatCountdown(9)).toBe("dans 9 min");
    expect(formatCountdown(60)).toBe("dans 1 h");
    expect(formatCountdown(65)).toBe("dans 1 h 05");
    expect(formatCountdown(0)).toBeNull();
  });
});

describe("buildMilestones", () => {
  const stamps = {
    createdAt: "2026-03-04T13:58:00",
    selectedAt: "2026-03-04T14:05:00",
    confirmedAt: "2026-03-04T14:12:00",
  };

  it("horodate les jalons franchis et laisse les suivants vides", () => {
    const milestones = buildMilestones({ status: "active", ...stamps });
    expect(milestones.map((m) => [m.label, m.time, m.state])).toEqual([
      ["Publiée", "13:58", "done"],
      ["Attribuée", "14:05", "done"],
      ["En cours", "14:12", "current"],
      ["Livrée", null, "pending"],
    ]);
  });

  it("ne date pas un jalon non encore atteint même si la base porte une valeur", () => {
    const milestones = buildMilestones({ status: "pending_confirmation", ...stamps });
    expect(milestones[2]).toMatchObject({ label: "En cours", time: null, state: "pending" });
    expect(milestones[1].state).toBe("current");
  });

  it("marque la course livrée jusqu'au bout", () => {
    const milestones = buildMilestones({ status: "completed", ...stamps, completedAt: "2026-03-04T14:47:00" });
    expect(milestones.map((m) => m.state)).toEqual(["done", "done", "done", "current"]);
    expect(milestones[3].time).toBe("14:47");
  });

  it("supporte une course encore ouverte, sans livreur", () => {
    const milestones = buildMilestones({ status: "open", createdAt: stamps.createdAt });
    expect(milestones[0]).toMatchObject({ time: "13:58", state: "current" });
    expect(milestones.slice(1).every((m) => m.time === null && m.state === "pending")).toBe(true);
  });

  it("place draft et open au même rang", () => {
    expect(milestoneIndex("draft")).toBe(milestoneIndex("open"));
  });
});

describe("trackingStatusLabel", () => {
  it("dit vers où va le livreur quand il y en a un", () => {
    expect(trackingStatusLabel("active", true)).toBe("EN ROUTE VERS LA RÉCUPÉRATION");
    expect(trackingStatusLabel("active", false)).toBe("COURSE EN COURS");
  });

  it("couvre les autres statuts métier", () => {
    expect(trackingStatusLabel("pending_confirmation", true)).toBe("EN ATTENTE DE CONFIRMATION");
    expect(trackingStatusLabel("completed", true)).toBe("COURSE LIVRÉE");
    expect(trackingStatusLabel("open", false)).toBe("EN ATTENTE D'UN LIVREUR");
    expect(trackingStatusLabel("cancelled", false)).toBe("COURSE INACTIVE");
  });
});

describe("deliveryReference", () => {
  it("reprend les huit premiers caractères, comme la fiche livraison", () => {
    expect(deliveryReference("1d2de612-9a44-4c1b-8f0e-9d3a1b2c3d4e")).toBe("1D2DE612");
    expect(deliveryReference(undefined)).toBe("—");
  });
});
