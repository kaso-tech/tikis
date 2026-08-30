import { describe, expect, it } from "vitest";
import { deliveryMetricsForDay } from "../lib/wallet-metrics";
import type { FinancialRecord } from "../shared/tikis-domain";

const record = (overrides: Partial<FinancialRecord>): FinancialRecord => ({
  id: "entry-1",
  deliveryId: "",
  createdAt: "2026-08-30T10:00:00.000Z",
  operation: "credit",
  amount: 1000,
  balanceBefore: 0,
  balanceAfter: 1000,
  reason: "Opération",
  ...overrides,
});

describe("métriques de gains Wallet", () => {
  it("exclut les dépôts des gains et ne conserve que les crédits rattachés à une livraison", () => {
    const metrics = deliveryMetricsForDay([
      record({ id: "deposit", deliveryId: "", amount: 5000, reason: "Dépôt YengaPay en mode test confirmé" }),
      record({ id: "course", deliveryId: "delivery-1", amount: 3200, reason: "Gain de livraison" }),
    ], new Date("2026-08-30T12:00:00.000Z"));

    expect(metrics).toEqual({ activityCount: 1, earnings: 3200, completedCourses: 1 });
  });
});
