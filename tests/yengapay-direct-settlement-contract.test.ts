import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const direct = readFileSync(join(process.cwd(), "server/yengapay-direct.ts"), "utf8");
const database = readFileSync(join(process.cwd(), "server/db.ts"), "utf8");
const migration = readFileSync(join(process.cwd(), "drizzle/manual/0040_direct_deposit_metadata.sql"), "utf8");

describe("règlement YengaPay Direct", () => {
  it("utilise le provider correspondant au mode externe", () => {
    expect(database).toContain('recordDirectDepositIntent');
    expect(database).toContain('"yengapay_direct_sandbox"');
    expect(database).toContain('"yengapay_direct_live"');
    expect(direct).toContain('mode: config.mode');
    expect(migration).toContain("yengapay_direct_sandbox");
    expect(migration).toContain("yengapay_direct_live");
  });

  it("crédite le Wallet avant de marquer la transaction réussie", () => {
    expect(direct).toContain('await db.settleTikisWalletDepositRequest');
    expect(direct).toContain('if (status === "succeeded")');
    expect(direct).not.toContain('await db.settleDirectDeposit');
  });

  it("refuse une transaction échouée sans mouvement de crédit", () => {
    expect(direct).toContain('await db.refuseTikisWalletDepositRequest');
    expect(direct).toContain('else if (status === "failed")');
  });
});
