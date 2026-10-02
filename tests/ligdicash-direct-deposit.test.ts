import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  transactionId: string; profilePhone: string; amount: number; phone: string; operator: "orange_money" | "moov_money";
  countryCode: string; ussdCode: string; providerReference: string; status: "pending" | "succeeded" | "failed" | "cancelled" | "expired";
  expiresAt: string; createdAt: string; settledAt: string | null; mode: "test" | "sandbox" | "live"; provider: "yengapay" | "ligdicash";
  providerToken: string | null; idempotencyKey: string; checkoutUrl?: string | null;
};
const rows = new Map<string, Row>();
const credited: string[] = [];

vi.mock("../server/db", () => ({
  getDirectDepositByIdempotencyKey: async (phone: string, key: string) => [...rows.values()].find((r) => r.profilePhone === phone && r.idempotencyKey === key) ?? null,
  recordDirectDepositIntent: async (input: Omit<Row, "status" | "createdAt" | "settledAt" | "mode" | "provider" | "providerToken"> & { mode: Row["mode"]; provider: Row["provider"] }) => {
    rows.set(input.transactionId, { ...input, status: "pending", createdAt: new Date().toISOString(), settledAt: null, providerToken: null });
  },
  getDirectDepositIntent: async (id: string, phone: string) => { const r = rows.get(id); return r && r.profilePhone === phone ? { ...r } : null; },
  getDirectDepositById: async (id: string) => (rows.has(id) ? { ...rows.get(id)! } : null),
  setDirectDepositProviderToken: async (id: string, token: string, checkoutUrl?: string | null) => { rows.get(id)!.providerToken = token; if (checkoutUrl) rows.get(id)!.checkoutUrl = checkoutUrl; },
  settleTikisseWalletDepositRequest: async ({ transactionId }: { transactionId: string }) => { const r = rows.get(transactionId)!; if (r.status !== "succeeded") { credited.push(transactionId); r.status = "succeeded"; } },
  refuseTikisseWalletDepositRequest: async ({ transactionId }: { transactionId: string }) => { const r = rows.get(transactionId)!; if (r.status === "pending") r.status = "failed"; },
  cancelTikisseWalletDirectDeposit: async ({ transactionId, status }: { transactionId: string; status: "cancelled" | "expired" }) => { const r = rows.get(transactionId)!; if (r.status === "pending") r.status = status; return { ...r }; },
}));
vi.mock("../server/yengapay-direct", () => ({}));

const { ligdicashPayinBody, ligdicashStatus, readLigdicashConfig } = await import("../server/ligdicash");
const deposit = await import("../server/direct-deposit");

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
let calls: Call[] = [];
let replies: Array<Record<string, unknown>> = [];

beforeEach(() => {
  rows.clear(); credited.length = 0; calls = []; replies = [];
  vi.stubEnv("TIKISSE_DIRECT_PAYMENT_PROVIDER", "ligdicash");
  vi.stubEnv("LIGDICASH_API_KEY", "cle-test");
  vi.stubEnv("LIGDICASH_AUTH_TOKEN", "jeton-test");
  vi.stubEnv("LIGDICASH_MODE", "sandbox");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? "GET", headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(replies.shift() ?? { response_code: "00", status: "pending" }), { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

type OperatorId = "orange_money" | "moov_money" | "mtn_money" | "wave" | "airtel_money" | "yas_money";
const request = (operator: OperatorId, key = "cle-idempotence-0001", countryCode = "BF") => ({ profilePhone: "+22670000001", amount: 2500, phone: "+22670111222", operator, countryCode, idempotencyKey: key });

describe("LigdiCash : format des requêtes", () => {
  it("corps du paiement sans redirection : numéro sans « + », code, rappel vers la transaction", () => {
    const body = ligdicashPayinBody(readLigdicashConfig({ TIKISSE_PUBLIC_API_URL: "https://api.tikisse.com" }), { transactionId: "11111111-1111-1111-1111-111111111111", amount: 2500, phone: "+22670111222", otp: "123456", description: "Rechargement" });
    expect(body.commande.invoice).toMatchObject({ customer: "22670111222", otp: "123456", total_amount: 2500, devise: "XOF", external_id: "11111111-1111-1111-1111-111111111111" });
    expect(body.commande.invoice.items[0]).toMatchObject({ quantity: 1, unit_price: 2500, total_price: 2500 });
    expect(body.commande.actions.callback_url).toBe("https://api.tikisse.com/api/webhooks/ligdicash?transaction=11111111-1111-1111-1111-111111111111");
  });

  it("statuts : seul « completed » vaut paiement", () => {
    expect(ligdicashStatus("completed")).toBe("succeeded");
    expect(ligdicashStatus("pending")).toBe("pending");
    expect(ligdicashStatus("nocompleted")).toBe("failed");
  });
});

describe("Moov Money via LigdiCash : validation sur le téléphone, sans code", () => {
  it("la demande part dès la création, avec un code vide, sur la plateforme de test", async () => {
    replies.push({ response_code: "00", token: "jeton-moov", response_text: "en cours" });
    const view = await deposit.createDirectDeposit(request("moov_money"));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://test.ligdicash.com/pay/v01/straight/checkout-invoice/create");
    expect(calls[0].headers).toMatchObject({ Apikey: "cle-test", Authorization: "Bearer jeton-test" });
    expect((calls[0].body as { commande: { invoice: { otp: string } } }).commande.invoice.otp).toBe("");
    expect(view).toMatchObject({ provider: "ligdicash", flow: "PUSH", requiresOtp: false, status: "pending" });
    expect(rows.get(view.transactionId)!.providerToken).toBe("jeton-moov");
  });

  it("le Wallet n'est crédité qu'après confirmation « completed » de LigdiCash", async () => {
    replies.push({ response_code: "00", token: "jeton-moov" });
    const view = await deposit.createDirectDeposit(request("moov_money"));
    replies.push({ response_code: "00", status: "pending" });
    expect((await deposit.getDirectDepositStatus({ profilePhone: "+22670000001", transactionId: view.transactionId })).status).toBe("pending");
    replies.push({ response_code: "00", status: "completed", amount: 2500 });
    expect((await deposit.getDirectDepositStatus({ profilePhone: "+22670000001", transactionId: view.transactionId })).status).toBe("succeeded");
    expect(calls.at(-1)!.url).toContain("redirect/checkout-invoice/confirm/?invoiceToken=jeton-moov");
    expect(credited).toEqual([view.transactionId]);
  });

  it("montant confirmé inférieur au montant demandé : pas de crédit", async () => {
    replies.push({ response_code: "00", token: "jeton-moov" });
    const view = await deposit.createDirectDeposit(request("moov_money"));
    replies.push({ response_code: "00", status: "completed", amount: 100 });
    await deposit.getDirectDepositStatus({ profilePhone: "+22670000001", transactionId: view.transactionId });
    expect(credited).toEqual([]);
  });
});

describe("Orange Money via LigdiCash : code obtenu par *144*4*6#", () => {
  it("rien ne part avant le code ; puis une seule demande avec le code", async () => {
    const view = await deposit.createDirectDeposit(request("orange_money"));
    expect(calls).toHaveLength(0);
    expect(view).toMatchObject({ requiresOtp: true, ussdCode: "*144*4*6#", flow: "ONE_STEP" });
    replies.push({ response_code: "00", token: "jeton-orange" }, { response_code: "00", status: "pending" });
    const paid = await deposit.payDirectDeposit({ profilePhone: "+22670000001", transactionId: view.transactionId, otp: "654321" });
    expect((calls[0].body as { commande: { invoice: { otp: string } } }).commande.invoice.otp).toBe("654321");
    expect(paid.requiresOtp).toBe(false);
    // Second appui : aucune seconde demande de paiement, seulement une vérification.
    replies.push({ response_code: "00", status: "pending" });
    await deposit.payDirectDeposit({ profilePhone: "+22670000001", transactionId: view.transactionId, otp: "654321" });
    expect(calls.filter((c) => c.url.includes("checkout-invoice/create"))).toHaveLength(1);
  });

  it("code refusé par LigdiCash : transaction close, raison affichée", async () => {
    const view = await deposit.createDirectDeposit(request("orange_money"));
    replies.push({ response_code: "01", response_text: "OTP invalide", description: "Code OTP incorrect" });
    await expect(deposit.payDirectDeposit({ profilePhone: "+22670000001", transactionId: view.transactionId, otp: "000000" })).rejects.toThrow("Code OTP incorrect");
    expect(rows.get(view.transactionId)!.status).toBe("failed");
  });
});

describe("rappel LigdiCash", () => {
  it("ne crédite rien sur la foi du rappel : le statut est redemandé à LigdiCash", async () => {
    replies.push({ response_code: "00", token: "jeton-moov" });
    const view = await deposit.createDirectDeposit(request("moov_money"));
    replies.push({ response_code: "00", status: "completed", amount: 2500 });
    expect(await deposit.handleLigdicashCallback(view.transactionId)).toEqual({ status: 200, body: { ok: true, status: "succeeded" } });
    expect(calls.at(-1)!.url).toContain("invoiceToken=jeton-moov");
    expect(await deposit.handleLigdicashCallback("pas-un-identifiant")).toMatchObject({ status: 400 });
    expect(await deposit.handleLigdicashCallback("22222222-2222-2222-2222-222222222222")).toMatchObject({ status: 404 });
  });
});

describe("erreurs LigdiCash lisibles", () => {
  it("identifiants refusés : le message pointe la configuration", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Unauthorized", { status: 401 })));
    await expect(deposit.createDirectDeposit(request("moov_money", "cle-idempotence-0401"))).rejects.toThrow("LIGDICASH_API_KEY");
  });

  it("raison donnée dans le corps d'une erreur HTTP : affichée telle quelle", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ response_code: "02", description: "Numéro non éligible" }), { status: 400 })));
    await expect(deposit.createDirectDeposit(request("moov_money", "cle-idempotence-0400"))).rejects.toThrow("Numéro non éligible");
  });

  it("serveur injoignable : message explicite", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    await expect(deposit.createDirectDeposit(request("moov_money", "cle-idempotence-0500"))).rejects.toThrow("injoignable");
  });
});

describe("opérateurs pays par pays", () => {
  it("MTN Côte d'Ivoire : demande immédiate sans code, consigne du SMS à suivre", async () => {
    replies.push({ response_code: "00", token: "jeton-mtn" });
    const view = await deposit.createDirectDeposit(request("mtn_money", "cle-idempotence-ci01", "CI"));
    expect(calls).toHaveLength(1);
    expect((calls[0].body as { commande: { invoice: { otp: string } } }).commande.invoice.otp).toBe("");
    expect(view).toMatchObject({ flow: "GUIDED", requiresOtp: false });
    expect(view.otpInstructions).toContain("SMS");
  });

  it("Orange Mali : page de paiement renvoyée par LigdiCash, gardée pour l'application", async () => {
    replies.push({ response_code: "00", token: "jeton-om-ml", response_text: "https://paiement.orange.ml/session/abc" });
    const view = await deposit.createDirectDeposit(request("orange_money", "cle-idempotence-ml01", "ML"));
    expect(view).toMatchObject({ flow: "REDIRECT", requiresOtp: false });
    expect(rows.get(view.transactionId)!.providerToken).toBe("jeton-om-ml");
    expect(view.checkoutUrl).toBe("https://paiement.orange.ml/session/abc");
  });

  it("opérateur absent du pays, ou pays sans opérateur : refus, rien n'est envoyé", async () => {
    await expect(deposit.createDirectDeposit(request("wave", "cle-idempotence-bf99", "BF"))).rejects.toThrow("pas disponible dans votre pays");
    await expect(deposit.createDirectDeposit(request("orange_money", "cle-idempotence-gh01", "GH"))).rejects.toThrow("pas disponible dans votre pays");
    expect(calls).toHaveLength(0);
  });
});
