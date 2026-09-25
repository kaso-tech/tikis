# Setup YengaPay Sandbox — guide opérationnel

## Vue d'ensemble

Le mode `sandbox` de YengaPay permet de tester l'intégration de bout en bout sans
engager de vrais fonds. Ce guide décrit comment obtenir les credentials sandbox,
configurer l'environnement local, et valider que tout fonctionne.

## 1. Obtenir un compte sandbox

1. Aller sur https://merchant.yengapay.com (ou l'URL d'admin sandbox fournie par YengaPay).
2. Créer un compte marchand si pas déjà fait.
3. Créer une **organisation** (UUID) et un **projet** (UUID) dédiés à Tikis.
4. Générer une **clé API** avec les scopes `payment:create` et `payment:read`.
5. Copier le **secret webhook** depuis la section "Webhooks" du projet.

Ces 4 valeurs correspondent aux variables d'environnement :
| Variable console YengaPay | Variable d'env Tikis |
|---|---|
| Organization ID | `YENGAPAY_ORG_ID` |
| Project ID | `YENGAPAY_PROJECT_ID` |
| API Key | `YENGAPAY_API_KEY` |
| Webhook Secret | `YENGAPAY_WEBHOOK_SECRET` |

## 2. Configurer l'environnement local

Créer (ou éditer) `.env.local` à la racine du repo :

```bash
# YengaPay — mode sandbox
YENGAPAY_MODE=sandbox
YENGAPAY_API_KEY=sk_test_xxxxxxxxxxxx
YENGAPAY_ORG_ID=org_xxxxxxxxxxxx
YENGAPAY_PROJECT_ID=prj_xxxxxxxxxxxx
YENGAPAY_WEBHOOK_SECRET=whsec_xxxxxxxxxxxx

# Optionnel : override de l'URL de base (par défaut api.sandbox.yengapay.com)
# YENGAPAY_BASE_URL=https://api.sandbox.yengapay.com/api/v1
```

⚠️ **Ne jamais commit ce fichier** — il contient des secrets. Vérifier qu'il est dans `.gitignore`.

## 3. Lancer la validation sandbox

Un script bash automatise la vérification : présence des variables, exécution des
tests d'intégration sandbox.

```bash
./scripts/validate-yengapay-sandbox.sh
```

Le script :
1. Vérifie la présence des 4 variables d'env obligatoires.
2. Active `YENGAPAY_RUN_SANDBOX_CHECKOUT_TEST=true` et `YENGAPAY_RUN_SANDBOX_DIRECT_DEPOSIT_TEST=true`.
3. Exécute 3 fichiers de tests :
   - `tests/yengapay-sandbox-credentials.test.ts` — sanity check : la clé API atteint bien la sandbox.
   - `tests/yengapay-sandbox-checkout.test.ts` — crée une intention de dépôt checkout, vérifie l'URL retournée.
   - `tests/yengapay-sandbox-direct-deposit.test.ts` — crée une intention de dépôt direct, vérifie le code USSD.
4. Affiche un rapport coloré.

Codes de sortie :
- `0` : tous les tests sont passés.
- `1` : au moins une variable manque, ou un test a échoué.

## 4. Smoke test du handler webhook

Une fois le serveur Tikis lancé en local (`pnpm dev`), valider que le handler
`/api/webhooks/yengapay` accepte un payload signé et rejette une signature invalide :

```bash
YENGAPAY_WEBHOOK_SECRET=<le même secret que dans .env.local> \
  BASE_URL=http://localhost:3000 \
  node scripts/smoke-test-yengapay-webhook.mjs
```

Le script envoie 3 scénarios :
- Payload avec signature HMAC valide.
- Payload avec signature HMAC falsifiée → doit recevoir 400 "Signature invalide".
- Payload d'un event `pending` → doit recevoir 202.

En mode `sandbox`, le handler retourne généralement 200 (event loggué + settle tenté)
ou 202 (settle en attente). En mode `test`, il renvoie 503 (webhook désactivé).

## 5. Configurer l'URL webhook dans la console YengaPay

Une fois l'environnement local validé :

1. Console YengaPay → Projet → Webhooks.
2. Ajouter une URL : `https://<host-de-tikis>/api/webhooks/yengapay`
3. Le PSP signe alors les events avec `YENGAPAY_WEBHOOK_SECRET`.
4. Sélectionner les events à notifier :
   - `payment.pending`
   - `payment.succeeded`
   - `payment.failed`
   - `payment.cancelled`

Tikis vérifie la signature dans `verifyYengapayWebhookSignature` (server/yengapay.ts).

## 6. Tests end-to-end avec un vrai numéro sandbox

Une fois le webhook configuré et le serveur accessible publiquement :

1. Lancer l'app Tikis en mode `sandbox` (cf. `YENGAPAY_MODE=sandbox`).
2. Ouvrir le wallet → "Dépôt direct" → saisir un numéro Mobile Money sandbox.
3. Lancer le paiement.
4. Vérifier côté serveur :
   - `tikis_payment_transactions` : nouveau row avec `status='pending'`, `provider='yengapay_direct_sandbox'`.
   - Logs : `[webhook:yengapay] settle failed` ou succès selon le PSP.
   - `tikis_yengapay_webhook_events` : event loggué avec provider exact.
5. Simuler la confirmation côté PSP sandbox (la console fournit un bouton "force
   succeeded" sur les paiements de test).
6. Vérifier que :
   - Le webhook arrive avec `payment.succeeded`.
   - Le handler retourne 200.
   - `tikis_payment_transactions.status = 'succeeded'`.
   - Le Wallet est crédité (visible dans `tikis_wallet_ledger`).
   - L'utilisateur reçoit une push notif "Dépôt Mobile Money confirmé".

## 7. Debugging

### Le test credentials échoue avec 401/403

- Clé API incorrecte → régénérer une nouvelle clé dans la console YengaPay.
- Mauvais projet ou organisation → vérifier `YENGAPAY_ORG_ID` et `YENGAPAY_PROJECT_ID`.
- Permissions insuffisantes → vérifier que la clé a les scopes `payment:create` et `payment:read`.

### Le handler webhook renvoie 400 "Signature invalide"

- `YENGAPAY_WEBHOOK_SECRET` côté serveur ≠ celui côté PSP → aligner les deux.
- Body modifié en transit par un proxy qui ré-écrit le JSON → désactiver la
  ré-écriture ou configurer le proxy pour transmettre le body brut.

### Le handler renvoie 503

- `YENGAPAY_MODE=test` côté serveur → vérifier que le mode est bien `sandbox` ou `live`.

### Le handler renvoie 202 "willRetry"

- L'intent n'existe pas en base : race condition entre l'appel API de création et
  l'arrivée du webhook. Retry manuel via `admin.finance.reconcileYengapayPayment`
  une fois la transaction créée.

### L'API YengaPay renvoie 400 sur la création d'intent

- Numéro de téléphone mal formaté → vérifier que c'est bien un E.164 (`+226...`).
- `paymentSource` invalide → doit être `"orange_money"` ou `"moov_money"`.
- `customerNumber` manquant → le champ est obligatoire pour les paiements directs.

### L'USSD ne fonctionne pas

- Le code USSD hardcodé dans `buildUssdCode` (`*144*4*6*<montant>#` pour Orange)
  est une **estimation**. Le pattern réel dépend de la config YengaPay du marchand.
  → Mettre à jour `buildUssdCode` dans `server/yengapay-direct.ts` après validation
  avec la sandbox.
- L'OTP peut être reçu avec un délai de 30s à 5min selon l'opérateur.

## 8. Passage en mode `live`

Une fois la sandbox validée :

1. Console YengaPay → Créer un projet Live (≠ Sandbox).
2. Régénérer une clé API pour le projet Live.
3. Mettre à jour `.env` (prod) :
   ```
   YENGAPAY_MODE=live
   YENGAPAY_API_KEY=sk_live_...
   YENGAPAY_ORG_ID=org_...
   YENGAPAY_PROJECT_ID=prj_...
   YENGAPAY_WEBHOOK_SECRET=whsec_...
   ```
4. Configurer le webhook Live avec l'URL de production.
5. Vérifier que `assertYengapayWebhookSecretConfigured` (server/yengapay.ts) passe :
   en `NODE_ENV=production` avec `YENGAPAY_MODE=live`, le serveur refuse de démarrer
   sans `YENGAPAY_WEBHOOK_SECRET`.

## 9. Sécurité des secrets

- `.env.local` est dans `.gitignore` (à vérifier).
- En production, utiliser un secret manager (Vault, AWS Secrets Manager, etc.).
- Ne jamais logger les valeurs de `YENGAPAY_API_KEY` ou `YENGAPAY_WEBHOOK_SECRET`.
- La console YengaPay permet de révoquer une clé API compromise : le faire immédiatement
  en cas de fuite, puis régénérer une nouvelle clé + mettre à jour l'env.

## 10. Références

- [Documentation officielle YengaPay Direct](https://docs.yengapay.com/docs/guides/integration-api-direct)
- `docs/yengapay-integration-notes.md` — notes d'intégration initiales (Kreezus).
- `docs/yengapay-webhook.md` — contrat webhook (headers, payload, normalisation).
- `server/yengapay.ts` — implémentation (signature HMAC, parser, normalize).
- `server/yengapay-direct.ts` — module paiement direct (USSD, paymentSource).
- `server/_core/index.ts` — handler webhook `/api/webhooks/yengapay`.
- `tests/yengapay-sandbox-direct-deposit.test.ts` — test d'intégration sandbox direct.
- `scripts/validate-yengapay-sandbox.sh` — script de validation.
- `scripts/smoke-test-yengapay-webhook.mjs` — smoke test webhook local.
