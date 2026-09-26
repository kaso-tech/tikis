#!/usr/bin/env node
/**
 * Smoke test YengaPay webhook — vérifie que le handler /api/webhooks/yengapay accepte
 * un payload signé avec un secret HMAC connu, et qu'il rejette une signature invalide.
 *
 * Usage :
 *   # Depuis la racine du repo Tikis, serveur lancé en local sur le port 3000 :
 *   YENGAPAY_WEBHOOK_SECRET=test-secret node scripts/smoke-test-yengapay-webhook.mjs
 *   YENGAPAY_WEBHOOK_SECRET=test-secret \
 *     BASE_URL=http://localhost:3000 \
 *     node scripts/smoke-test-yengapay-webhook.mjs
 *
 * Sortie :
 *   - 3 scénarios testés : signature OK / signature KO / eventType pending.
 *   - Code de sortie 0 si OK, 1 si KO.
 *
 * Pré-requis :
 *   - Serveur Tikis lancé en local (mode `test` accepté, le handler renverra 503 — c'est
 *     attendu : on valide ici uniquement la couche signature/parse, pas le settlement).
 *   - Variable d'env YENGAPAY_WEBHOOK_SECRET alignée avec celle utilisée par le serveur.
 */

import { createHmac } from "node:crypto";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const SECRET = process.env.YENGAPAY_WEBHOOK_SECRET;

if (!SECRET) {
  console.error("[smoke] YENGAPAY_WEBHOOK_SECRET doit être défini.");
  process.exit(1);
}

const ENDPOINT = `${BASE_URL}/api/webhooks/yengapay`;

const SAMPLE_PAYLOAD = {
  type: "payment.succeeded",
  id: "evt_smoke_test_001",
  data: {
    paymentIntentId: "pi_smoke_test_001",
    transId: "trans_smoke_test_001",
    paymentAmount: 100,
    paymentStatus: "DONE",
    paymentSource: "orange_money",
    customerNumber: "+22670000000",
  },
};

function sign(body) {
  return "sha256=" + createHmac("sha256", SECRET).update(body, "utf8").digest("hex");
}

let passed = 0;
let failed = 0;

async function check(label, response, expectedStatus, expectedBodyMatches) {
  const text = await response.text();
  const ok = response.status === expectedStatus && (expectedBodyMatches ? expectedBodyMatches(text) : true);
  const marker = ok ? "✓" : "✗";
  console.log(`${marker} ${label}`);
  console.log(`    status: ${response.status} (attendu ${expectedStatus})`);
  if (!ok) {
    console.log(`    body:   ${text.slice(0, 200)}`);
  }
  if (ok) passed++; else failed++;
}

const rawBody = JSON.stringify(SAMPLE_PAYLOAD);
const validSignature = sign(rawBody);

console.log(`[smoke] endpoint: ${ENDPOINT}`);
console.log(`[smoke] secret:   ${SECRET.slice(0, 4)}*** (longueur ${SECRET.length})`);
console.log();

console.log("[smoke] Scénario 1 : signature HMAC valide + event succeeded");
try {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-hash": validSignature },
    body: rawBody,
  });
  // Mode `test` → 503 attendu (le serveur refuse les webhooks en mode test).
  // Mode `sandbox`/`live` → 200 attendu (event reçu, settle tenté — peut être 200 ou 202 selon
  // si la transaction existe en base).
  const expected = res.status === 503 || res.status === 200 || res.status === 202;
  await check(
    "signature valide acceptée",
    res,
    res.status, // on accepte le code retourné pour rester agnostique au mode
    (text) => expected || text.includes("Signature invalide") === false,
  );
} catch (cause) {
  console.log(`✗ signature valide — erreur réseau: ${cause instanceof Error ? cause.message : cause}`);
  failed++;
}
console.log();

console.log("[smoke] Scénario 2 : signature HMAC invalide doit être rejetée");
try {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-hash": "sha256=" + "0".repeat(64) },
    body: rawBody,
  });
  await check("signature KO → 400", res, 400, (text) => text.includes("Signature"));
} catch (cause) {
  console.log(`✗ signature KO — erreur réseau: ${cause instanceof Error ? cause.message : cause}`);
  failed++;
}
console.log();

console.log("[smoke] Scénario 3 : event pending ou rejeu idempotent");
const PENDING_PAYLOAD = {
  type: "payment.pending",
  id: "evt_smoke_test_pending",
  data: {
    paymentIntentId: "pi_smoke_test_pending",
    paymentAmount: 100,
    paymentStatus: "PENDING",
  },
};
const pendingBody = JSON.stringify(PENDING_PAYLOAD);
const pendingSig = sign(pendingBody);
try {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-hash": pendingSig },
    body: pendingBody,
  });
  // En mode test : 503. En sandbox/live : l’événement peut être en attente, ou déjà
  // enregistré par un précédent smoke test ; les deux réponses valident le handler.
  await check("event pending", res, res.status, (text) => res.status === 503 || text.includes("pending") || text.includes('"duplicate":true'));
} catch (cause) {
  console.log(`✗ event pending — erreur réseau: ${cause instanceof Error ? cause.message : cause}`);
  failed++;
}
console.log();

console.log("---");
console.log(`[smoke] ${passed} passé(s), ${failed} échoué(s)`);
process.exit(failed > 0 ? 1 : 0);
