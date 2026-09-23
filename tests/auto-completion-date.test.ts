import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { autoCompletionTimestamp, DELIVERY_EXPIRATION_MS } from "../shared/delivery-expiration";
import { deliveryMetricsForDay } from "../lib/wallet-metrics";
import type { FinancialRecord } from "../shared/tikis-domain";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const at = (iso: string) => new Date(iso).getTime();

describe("une course clôturée automatiquement est datée de son échéance", () => {
  // Le cas des captures : confirmée le 31 août à 10 h, la tâche planifiée ne passe que le 22 septembre.
  const confirmee = "2026-08-31T10:00:00Z";
  const passageDeLaTache = at("2026-09-22T07:43:00Z");

  it("à l'échéance des 24 h, pas à l'heure où la tâche passe", () => {
    expect(new Date(autoCompletionTimestamp(confirmee, passageDeLaTache)).toISOString()).toBe("2026-09-01T10:00:00.000Z");
  });

  it("et ne compte donc plus dans les gains du jour où la tâche a tourné", () => {
    const gain = (createdAt: number): FinancialRecord => ({
      id: "A:earning", deliveryId: "A", createdAt: new Date(createdAt).toISOString(), operation: "credit",
      amount: 1800, balanceBefore: 0, balanceAfter: 0, reason: "Gain net",
    });
    const leJourMeme = new Date(passageDeLaTache + 60 * 60 * 1000);
    // Avant : datée à l'heure de la tâche, elle gonflait les gains du 22 septembre.
    expect(deliveryMetricsForDay([gain(passageDeLaTache)], leJourMeme).earnings).toBe(1800);
    // Après : datée du 1er septembre, elle n'y figure plus.
    expect(deliveryMetricsForDay([gain(autoCompletionTimestamp(confirmee, passageDeLaTache))], leJourMeme).earnings).toBe(0);
  });

  it("une tâche passée à l'heure donne l'échéance exacte", () => {
    const echeance = at(confirmee) + DELIVERY_EXPIRATION_MS;
    expect(autoCompletionTimestamp(confirmee, echeance + 5 * 60 * 1000)).toBe(echeance);
  });

  it("ne date jamais une course dans le futur", () => {
    const tropTot = at(confirmee) + 60 * 60 * 1000;
    expect(autoCompletionTimestamp(confirmee, tropTot)).toBe(tropTot);
  });

  it("sans horodatage d'activité, retombe sur l'instant présent", () => {
    expect(autoCompletionTimestamp(null, passageDeLaTache)).toBe(passageDeLaTache);
  });

  it("la tâche planifiée passe par cette échéance, et `updatedAt` garde, lui, l'heure réelle de la mise à jour", () => {
    const db = read("server/db.ts");
    expect(db).toContain("const completedAt = new Date(autoCompletionTimestamp(activityAt ?? delivery.createdAt, now.getTime()));");
    expect(db).toContain('set({ status: "completed", completedAt, updatedAt: now })');
    expect(db).not.toContain('set({ status: "completed", completedAt: now, updatedAt: now })');
  });

  it("une migration redate les courses déjà clôturées, sans toucher aux autres", () => {
    // Exécutée sur MariaDB 10.11 avec quatre cas (clôture tardive, clôture manuelle, clôture à l'heure,
    // avis laissé après la clôture) et rejouée deux fois : voir le message du commit.
    const sql = read("drizzle/manual/0038_backfill_auto_completed_at.sql");
    expect(sql).toContain("CONCAT(d.`id`, ':auto-completed-driver')");
    expect(sql).toContain("previous.`createdAt` < closing.`createdAt`");
    expect(sql).toContain("+ INTERVAL 24 HOUR");
    expect(sql).toContain("LEAST(");
    expect(sql).toContain("d.`updatedAt` = d.`updatedAt`");
  });
});

describe("l'écran Gains n'estime plus l'avenir", () => {
  it("ni le calcul, ni la carte, ni l'API ne produisent d'estimation des jours à venir", () => {
    for (const fichier of ["server/analytics.ts", "components/tikis/driver-earnings-trend.tsx", "server/_test-helpers/driver-earnings-projection.ts"]) {
      const source = read(fichier);
      expect(source).not.toContain("projection30Days");
      expect(source).not.toContain("PROCHAINS JOURS");
      expect(source).not.toContain("* 30");
    }
    expect(read("server/routers.ts")).not.toContain("myDriverEarningsProjection");
  });
});
