# Runbook — Validation YengaPay Sandbox (coordination Manus)

> **À l'attention de Manus** : Mavis (root session `435691979251808`) a livré
> l'intégration YengaPay Direct (PR `33b6c38`), le webhook couvre les paiements
> directs (PR `c12b337`), la reprise des pending côté wallet (PR `256f9ea`),
> et les outils de validation sandbox (PR `909a2d9`). Tu as les clés
> sandbox dans ton env. Ce runbook décrit exactement quoi lancer et quoi
> remonter.

## Pré-requis côté Manus

Variables d'env attendues dans ton shell (déjà configurées selon Mavis) :

| Variable | Valeur (exemple) |
|---|---|
| `YENGAPAY_MODE` | `sandbox` |
| `YENGAPAY_API_KEY` | `sk_test_...` |
| `YENGAPAY_ORG_ID` | `org_...` |
| `YENGAPAY_PROJECT_ID` | `prj_...` |
| `YENGAPAY_WEBHOOK_SECRET` | `whsec_...` |

Repo Tikis sur origin/main, commit `909a2d9` minimum.

## Étape 1 — Sync avec main

```bash
cd /workspace/tikis
git fetch origin
git checkout main
git pull --rebase origin main
```

Tu dois voir en tête : `909a2d9 Merge mavis/yengapay-sandbox-validation : setup validation sandbox YengaPay`.

## Étape 2 — Validation sandbox automatisée

```bash
./scripts/validate-yengapay-sandbox.sh
```

Le script :
1. Vérifie les 4 variables d'env obligatoires.
2. Active `YENGAPAY_RUN_SANDBOX_CHECKOUT_TEST=true` et `YENGAPAY_RUN_SANDBOX_DIRECT_DEPOSIT_TEST=true`.
3. Exécute 3 fichiers de tests :
   - `tests/yengapay-sandbox-credentials.test.ts` — sanity check clé API.
   - `tests/yengapay-sandbox-checkout.test.ts` — checkout web sandbox.
   - `tests/yengapay-sandbox-direct-deposit.test.ts` — paiement direct sandbox (Orange + Moov).
4. Affiche un rapport coloré.

Exit code `0` = OK, `1` = au moins un KO.

## Étape 3 — Smoke test webhook local

Une fois `validate-yengapay-sandbox.sh` OK :

**Terminal 1** (serveur Tikis) :
```bash
pnpm dev   # ou npm run dev
# Attendre que Metro/Express soit prêt (HTTP 200 sur /api/health)
```

**Terminal 2** (smoke test) :
```bash
YENGAPAY_WEBHOOK_SECRET="$YENGAPAY_WEBHOOK_SECRET" \
  BASE_URL=http://localhost:3000 \
  node scripts/smoke-test-yengapay-webhook.mjs
```

3 scénarios testés :
- Signature valide → 200/202 (sandbox) ou 503 (test).
- Signature KO → 400 "Signature invalide".
- Event `payment.pending` → 503 (test) ou 202 + body contient "pending".

## Étape 4 — Rapport à remonter à Mavis

Format texte brut (pas de JSON, pas de markdown — c'est parsé tel quel) :

```
=== RAPPORT SANDBOX YENGAPAY ===

1. validate-yengapay-sandbox.sh :
   - Variables d'env : OK
   - Test credentials : PASSED
   - Test checkout    : PASSED
   - Test direct      : PASSED   (ou KO avec message d'erreur)

2. smoke-test webhook :
   - Scénario 1 (signature valide) : OK
   - Scénario 2 (signature KO)     : OK
   - Scénario 3 (event pending)    : OK

3. Observations PSP :
   - Code USSD Orange confirmé : *144*4*6*<montant>#   (ou autre)
   - Code USSD Moov confirmé   : *555*4*<montant>#     (ou autre)
   - Code HTTP pour succeeded  : 200                     (ou 202, autre)
   - Code HTTP pour failed     : 200                     (ou 202, autre)
   - Délai webhook après settle: ~2-5s                   (ou autre)
   - Anomalies logs serveur   : (rien / description)

4. Verdict :
   - GO   : intégration sandbox validée, prêt pour passer en live
   - NO-GO: raison (ex: code USSD Orange incorrect, signature rejetée, ...)
```

## Étape 5 — Si NO-GO : debugging

Voir `docs/yengapay-sandbox-setup.md` section 7 — 7 problèmes courants + solutions.

Cas les plus probables :
- **Code USSD Orange/Moov incorrect** → update `buildUssdCode` dans `server/yengapay-direct.ts` ligne 47-50. Commit sur branche dédiée, push, merge.
- **Webhook signature KO** → vérifier que `YENGAPAY_WEBHOOK_SECRET` côté Manus = celui configuré dans la console YengaPay.
- **Credentials KO** → régénérer une clé API dans la console YengaPay, mettre à jour ton env.
- **HTTP 503 sur smoke test** → `YENGAPAY_MODE` côté serveur ≠ `sandbox`. Vérifier `readYengapayConfig()` retourne `mode === "sandbox"`.

## Étape 6 — Si GO : préparation au passage en live

Une fois la validation OK, le passage en `live` nécessite :
1. Créer un projet Live sur la console YengaPay (≠ Sandbox).
2. Générer une nouvelle clé API + secret webhook pour le projet Live.
3. Mettre à jour les env vars prod (NE PAS toucher `.env.local`) :
   ```
   YENGAPAY_MODE=live
   YENGAPAY_API_KEY=sk_live_...
   YENGAPAY_ORG_ID=org_...
   YENGAPAY_PROJECT_ID=prj_...
   YENGAPAY_WEBHOOK_SECRET=whsec_...
   ```
4. Configurer l'URL webhook `https://<host-prod>/api/webhooks/yengapay` dans la console YengaPay.
5. Vérifier que `assertYengapayWebhookSecretConfigured` passe (le serveur refuse de démarrer en prod avec `mode=live` sans `YENGAPAY_WEBHOOK_SECRET`).

⚠️ **Ne pas commit les secrets** dans le repo. Utiliser un secret manager (Vault, AWS Secrets Manager, etc.) côté prod.

## Références

- `docs/yengapay-sandbox-setup.md` — guide setup complet (10 sections).
- `docs/yengapay-webhook.md` — contrat webhook (headers, payload, normalisation).
- `docs/yengapay-integration-notes.md` — notes d'intégration initiales (Kreezus).
- `server/yengapay.ts` — implémentation (signature HMAC, parser, normalize).
- `server/yengapay-direct.ts` — module paiement direct (USSD, paymentSource).
- `server/_core/index.ts` — handler `/api/webhooks/yengapay`.
- `tests/yengapay-sandbox-direct-deposit.test.ts` — test d'intégration sandbox direct.
- `scripts/validate-yengapay-sandbox.sh` — script de validation principal.
- `scripts/smoke-test-yengapay-webhook.mjs` — smoke test handler webhook.
