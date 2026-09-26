import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const mobile = readFileSync(join(process.cwd(), "components/tikis/wallet-direct-deposit.tsx"), "utf8");
const router = readFileSync(join(process.cwd(), "server/routers.ts"), "utf8");
const direct = readFileSync(join(process.cwd(), "server/yengapay-direct.ts"), "utf8");
const database = readFileSync(join(process.cwd(), "server/db.ts"), "utf8");

const createDirectSection = direct.slice(
  direct.indexOf("export async function createYengapayDirectDeposit"),
  direct.indexOf("export async function getYengapayDirectDepositStatus"),
);

describe("paiement direct YengaPay dans Tikis", () => {
  it("ne quitte pas l’application pour composer un code ou saisir un OTP local", () => {
    expect(mobile).not.toContain("expo-linking");
    expect(mobile).not.toContain("Linking.openURL");
    expect(mobile).not.toContain("onCallUSSD");
    expect(mobile).not.toContain("onOtpChange");
    expect(mobile).toContain("vous ne quittez pas Tikis");
    expect(mobile).toContain("Vérifier maintenant");
  });

  it("crée une intention idempotente sans inscrire de mouvement Wallet avant le statut fournisseur", () => {
    expect(createDirectSection).toContain("getDirectDepositByIdempotencyKey");
    expect(createDirectSection).toContain("idempotencyKey: input.idempotencyKey");
    expect(createDirectSection).not.toContain("requestTikisWalletOperation");
    expect(direct).toContain("settleTikisWalletDepositRequest");
    expect(database).toContain("checkoutUrl: null");
  });

  it("permet l’annulation persistée, l’expiration et interdit la simulation en Sandbox/Live", () => {
    expect(router).toContain("cancelDirectDeposit");
    expect(direct).toContain("cancelYengapayDirectDeposit");
    expect(direct).toContain('status: "expired"');
    expect(direct).toContain("readYengapayConfig().mode !== \"test\"");
    expect(database).toContain("cancelTikisWalletDirectDeposit");
    expect(database).toContain('"expired"');
  });
});
