# Webhook YengaPay — Intégration et contrats

## Vue d'ensemble

Le webhook YengaPay notifie Tikis quand l'état d'un paiement change côté PSP.
Tikis utilise le **même endpoint** pour deux familles de paiements :

| Famille | Provider (transaction) | Flow client | USSD |
|---|---|---|---|
| Checkout web | `yengapay_sandbox` / `yengapay_live` | Redirection vers `checkout.yengapay.com` | non |
| Direct Mobile Money | `yengapay_direct_sandbox` / `yengapay_direct_live` | Code USSD composé depuis l'app (`tel:` URI), OTP par SMS | oui |

Les deux familles partagent le même PSP et donc le même webhook. La distinction
se fait dans le handler Tikis via le `provider` déjà enregistré sur la transaction.

## Endpoint

```
POST https://<host>/api/webhooks/yengapay
```

L'endpoint :
- Vérifie la signature HMAC-SHA256 (secret dans `YENGAPAY_WEBHOOK_SECRET`).
- Est **idempotent** : un event dupliqué (même `providerEventId`) renvoie 200 sans re-settlement.
- Renvoie 503 si `YENGAPAY_MODE=test` (aucun PSP distant, donc rien à recevoir).
- Renvoie 400 si la signature est invalide ou le payload non parsable.
- Renvoie 202 `willRetry: true` si le settle échoue (race condition, DB down transitoire).

## Headers attendus

| Header | Requis | Description |
|---|---|---|
| `x-webhook-hash` | oui | Signature HMAC-SHA256 du body brut, format `sha256=<hex>` ou `<hex>` |
| `x-yengapay-signature` | fallback | Idem (alias accepté par certains SDK) |
| `x-yengapay-event` | non | Event name brut (peut être déduit du payload si absent) |
| `Content-Type` | oui | `application/json` |

## Body attendu (YengaPay Direct)

Exemple minimal (le handler est tolérant sur les noms de champs alternatifs) :

```json
{
  "type": "payment.succeeded",
  "id": "evt_01HXXX",
  "data": {
    "paymentIntentId": "pi_01HYYY",
    "paymentAmount": 2500,
    "paymentStatus": "SUCCESS",
    "customerNumber": "+22670123456"
  }
}
```

Champs reconnus (premier non-vide gagne) :
- `data.paymentIntentId` / `data.id` / `data.reference` → `providerReference`
- `data.paymentStatus` / `data.transactionStatus` / `data.status` → status normalisé
- `data.transId` / `data.transactionId` / `parsed.id` / `parsed.eventId` / `data.paymentIntentId` → `providerEventId`
- `data.paymentAmount` / `data.amount` → amount

Status normalisés :
- `DONE` / `SUCCESS` / `SUCCEEDED` / `COMPLETED` / `PAID` → `succeeded`
- `FAILED` / `FAIL` / `DECLINED` / `REJECTED` → `failed`
- `CANCELLED` / `CANCELED` / `EXPIRED` → `cancelled`
- autre → `pending`

## Événements routés

| Event type YengaPay | eventType interne | Action |
|---|---|---|
| `payment.pending` | `payment.pending` | 202, pas de settle (statut déjà pending côté Tikis) |
| `payment.succeeded` | `payment.succeeded` | `settleYengapayLivePayment` + push notif si paiement direct |
| `payment.failed` | `payment.failed` | `settleYengapayLivePayment` (status=failed) + push notif si paiement direct |
| `payment.cancelled` | `payment.cancelled` | `settleYengapayLivePayment` (status=cancelled) + push notif si paiement direct |
| `withdrawal.*` | `withdrawal.succeeded` / `withdrawal.failed` | (hors scope MVP Tikis) |

## Idempotence

- Chaque event YengaPay possède un `providerEventId` unique.
- Le handler loggue l'event dans `tikis_yengapay_webhook_events` avec une contrainte unique
  `(provider, providerEventId)`. Un duplicate renvoie `{ ok: true, duplicate: true }` sans settle.
- Le settle lui-même est idempotent : `settleYengapayLivePayment` vérifie `payment.status !== "pending"`
  et ne crédite pas deux fois.

## Notifications push (paiements directs uniquement)

Sur settle réussi d'un paiement direct (`yengapay_direct_*`), le handler envoie un push
Expo au téléphone associé :

- **Succès** : titre `"Dépôt Mobile Money confirmé"`, body `"<montant> FCFA crédités sur votre Wallet Tikis."`
- **Échec** : titre `"Dépôt Mobile Money échoué"`, body `"Le paiement n'a pas été confirmé par votre opérateur. Le solde de votre Wallet est inchangé."`
- **Cancelled** : idem échec.

Les paiements checkout web ne déclenchent pas de push : l'utilisateur voit déjà l'écran
de confirmation dans le navigateur YengaPay.

## Réconciliation manuelle

En cas d'incident webhook persistant, l'admin peut forcer une réconciliation :

```ts
// Console admin (TanStack Start)
tikisAdminRouter.finance.reconcileYengapayPayment.mutate({ providerReference })
```

Le handler :
1. Appelle `verifyYengapayPayment` (GET `/payment-intent/{project}/intent/{ref}`).
2. Si status pending → renvoie `{ pending: true }`, pas de settle.
3. Sinon → appelle `settleYengapayLivePayment({ providerReference, outcome })`.
4. Audité (`yengapay_payment_reconciled` dans le journal admin).

Endpoint réservé aux rôles `super_admin` et `finance`.

## Tests

Tests unitaires à exécuter (cf. `server/_test-helpers/yengapay-webhook.test.ts`) :

```bash
# Sans node_modules dans le sandbox, validation manuelle :
node -e "
const { verifyYengapayWebhookSignature, parseYengapayWebhookEvent } = require('./server/yengapay.ts');
// Signature HMAC-SHA256
const raw = JSON.stringify({ type: 'payment.succeeded', data: { paymentIntentId: 'pi_xxx', paymentStatus: 'SUCCESS' } });
const sig = 'sha256=' + require('crypto').createHmac('sha256', 'secret').update(raw).digest('hex');
console.log(verifyYengapayWebhookSignature(raw, sig, 'secret')); // true
// Parse
console.log(parseYengapayWebhookEvent(raw, sig));
"
```

## Configuration déploiement

Variables d'environnement :

| Variable | Requis en prod | Description |
|---|---|---|
| `YENGAPAY_MODE` | oui | `test` / `sandbox` / `live`. Mode par défaut si absent : `test`. |
| `YENGAPAY_API_KEY` | sandbox/live | Clé API du projet YengaPay |
| `YENGAPAY_ORG_ID` | sandbox/live | Identifiant d'organisation |
| `YENGAPAY_PROJECT_ID` | sandbox/live | Identifiant de projet |
| `YENGAPAY_BASE_URL` | non | Override l'URL par défaut (sandbox ou live) |
| `YENGAPAY_WEBHOOK_SECRET` | live (prod uniquement) | Secret HMAC pour la vérif de signature. **Requis en prod pour `mode=live`**, sinon le serveur refuse de démarrer. |

## Sécurité

- Trust proxy : 1 saut (cf. `server/_core/index.ts:56`). Sans cela, `req.ip` serait celle du reverse proxy et non du client.
- Raw body capturé pour `/api/webhooks` (cf. `server/_core/index.ts:68`) pour permettre la vérif de signature sans parser le JSON deux fois.
- Pas d'auth utilisateur (le webhook est public), uniquement vérif HMAC.
- Rate limit global appliqué via `publicApiRateLimit` (cf. ligne 65).

## Sources

- Documentation YengaPay Direct : https://docs.yengapay.com/docs/guides/integration-api-direct
- Code : `server/yengapay.ts` (signature, parser, normalize), `server/_core/index.ts:151` (handler), `server/db.ts:settleYengapayLivePayment` (settlement), `server/db.ts:lookupTikisPaymentByProviderReference` (lookup pre-settle).
