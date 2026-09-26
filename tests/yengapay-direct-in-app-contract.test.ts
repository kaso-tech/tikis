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
  it("ne quitte pas l’application pour saisir et confirmer l’OTP", () => {
    expect(mobile).not.toContain("expo-linking");
    expect(mobile).toContain("Linking.openURL");
    expect(mobile).not.toContain("onCallUSSD");
    expect(mobile).not.toContain("YengaPay envoie la demande de validation au numéro saisi");
    expect(mobile).toContain("Composez le code ci-dessous sur votre téléphone pour obtenir le code OTP :");
    expect(mobile).toContain('type Stage = "request" | "confirmation" | "success" | "failed";');
    expect(mobile).toContain("ÉTAPE 1 SUR 2 · INFORMATIONS DE LA DEMANDE");
    expect(mobile).toContain("ÉTAPE 2 SUR 2 · CONFIRMATION DU PAIEMENT");
    expect(mobile).toContain("Valider les informations");
    expect(mobile).toContain("Actualiser le statut");
    expect(mobile).toContain("Modifier les informations");
    expect(mobile).toContain("Annuler la demande");
    expect(mobile).toContain("Confirmer le paiement");
    expect(mobile).toContain("Code OTP à six chiffres");
    expect(mobile).toContain("tel:");
    expect(mobile).toContain("buildUssdCode");
    expect(mobile).toContain('placeholder="Ex: 2500"');
    expect(mobile).toContain("const QUICK_AMOUNTS = [1_000, 5_000, 10_000, 25_000]");
    expect(mobile).toContain('onChangeAmount("500")');
    expect(mobile).toContain('disabled={confirming}');
    expect(mobile).not.toContain('disabled={!deposit || confirming || checking}');
  });

  it("crée une intention idempotente sans inscrire de mouvement Wallet avant le statut fournisseur", () => {
    expect(createDirectSection).toContain("getDirectDepositByIdempotencyKey");
    expect(createDirectSection).toContain("idempotencyKey: input.idempotencyKey");
    expect(createDirectSection).not.toContain("requestTikisWalletOperation");
    expect(createDirectSection).toContain('callDirect(config, "/init"');
    expect(createDirectSection).toContain('callDirect(config, "/send-otp"');
    expect(direct).toContain('callDirect(config, "/pay"');
    expect(router).toContain("payDirectDeposit");
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
