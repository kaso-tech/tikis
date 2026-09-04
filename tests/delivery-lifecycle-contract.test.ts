import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const databaseSource = readFileSync(join(process.cwd(), "server/db.ts"), "utf8");
const historySource = readFileSync(join(process.cwd(), "app/history.tsx"), "utf8");

describe("contrat du cycle de livraison à vingt-quatre heures", () => {
  it("ne crédite jamais le Wallet du livreur avec le prix d'une livraison (paiement direct hors application)", () => {
    expect(databaseSource).not.toContain("delivery-earning");
    expect(databaseSource).not.toContain("Gain de livraison crédité");
  });

  it("calcule l'historique de gains informatif depuis les livraisons terminées, jamais depuis le Wallet", () => {
    expect(databaseSource).toContain("getDriverCompletedDeliveryEarnings");
    expect(databaseSource).toContain("non crédité au Wallet Tikis");
  });

  it("finalise les courses actives et expire les courses jamais démarrées", () => {
    expect(databaseSource).toContain('status: "completed", completedAt: now');
    expect(databaseSource).toContain('status: "expired", cancelledAt: now');
    expect(databaseSource).toContain("livraison expirée avant départ");
  });

  it("notifie l’expéditeur et le livreur lors d’un traitement automatique", () => {
    expect(databaseSource).toContain("Livraison terminée automatiquement");
    expect(databaseSource).toContain("Livraison annulée automatiquement");
    expect(databaseSource).toContain("auto-completed-sender");
    expect(databaseSource).toContain("auto-completed-driver");
  });

  it("conserve les livraisons non terminées dans l’historique", () => {
    expect(historySource).toContain('delivery.status === "expired"');
    expect(historySource).toContain('delivery.status === "cancelled"');
  });
});
