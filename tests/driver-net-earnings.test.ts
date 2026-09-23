import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commissionFor, netDriverEarning } from "../shared/tikis-domain";
import { deliveryMetricsForDay } from "../lib/wallet-metrics";
import type { FinancialRecord } from "../shared/tikis-domain";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("le gain d'un livreur est net de commission", () => {
  it("une course de 2 000 FCFA commissionnée à 10 % rapporte 1 800 FCFA", () => {
    const price = 2000;
    const commission = commissionFor(price, { rate: 0.1, currency: "FCFA" });
    expect(commission).toBe(200);
    expect(netDriverEarning(price, commission)).toBe(1800);
  });

  it("une livraison antérieure au champ de commission garde son montant brut plutôt qu'un chiffre inventé", () => {
    expect(netDriverEarning(2000, null)).toBe(2000);
    expect(netDriverEarning(2000, undefined)).toBe(2000);
  });

  it("ne descend jamais sous zéro : une commission aberrante ne doit pas amputer les autres courses", () => {
    expect(netDriverEarning(2000, 3000)).toBe(0);
  });

  it("le serveur passe par ce calcul au lieu de renvoyer le prix de la course", () => {
    const database = read("server/db.ts");
    const earnings = database.slice(
      database.indexOf("export async function getDriverCompletedDeliveryEarnings"),
      database.indexOf("export async function requestTikisWalletOperation"),
    );
    expect(earnings).toContain("netDriverEarning(gross, commission)");
    expect(earnings).toContain("row.accruedCommission ?? 0");
    // Le montant brut ne doit plus être celui qu'on publie.
    expect(earnings).not.toContain("amount: gross");
  });

  it("les totaux de l'accueil et de l'onglet Gains additionnent ce montant déjà net, sans le recommissionner", () => {
    // `deliveryMetricsForDay` alimente « Gains du jour » ; l'onglet Gains fait la même somme sur `amount`.
    // Aucun des deux ne doit retrancher une seconde fois la commission.
    const entry = (amount: number): FinancialRecord => ({
      id: `d:${amount}`, deliveryId: "d", createdAt: new Date().toISOString(), operation: "credit",
      amount, balanceBefore: 0, balanceAfter: 0, reason: "Gain net",
    });
    expect(deliveryMetricsForDay([entry(1800), entry(900)]).earnings).toBe(2700);
    expect(read("app/(tabs)/earnings.tsx")).not.toContain("commissionFor");
    expect(read("lib/wallet-metrics.ts")).not.toContain("commissionFor");
  });
});
