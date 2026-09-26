# Notes d’intégration YengaPay

Source : https://kreezus.notion.site/DOCUMENTATION-API-YENGAPAY-KREEZUS-e9de95e48d504110aa048261a200292a

YengaPay requiert un compte marchand, un identifiant d’organisation, un identifiant de projet et une clé API créée pour les paiements entrants. Les paiements entrants et sortants peuvent notifier l’application par webhook. Les webhooks sont authentifiés avec une signature HMAC-SHA256 utilisant le `YENGAPAY_WEBHOOK_SECRET` du projet et l’en-tête `x-webhook-hash`.

La documentation fournie indique l’API REST `https://api.yengapay.com/api/v1`. Les appels authentifiés utilisent l’en-tête `x-api-key`. L’Organisation ID est passé dans le segment technique `groups/{organizationId}`. La vérification d’une intention Checkout est exposée à `GET /groups/{organizationId}/payment-intent/project/{projectId}/intent/{paymentIntentId}`, tandis que le paiement final est lu à `GET /groups/{organizationId}/merchant-payment/project/{projectId}/payment/{reference}`.

Endpoint officiel retenu pour les dépôts : création d’intention Checkout `POST /groups/{organizationId}/payment-intent/{projectId}` avec `paymentAmount`, `reference`, `articles`, `customerNumber` et `additionalInfos` lorsque nécessaires. La réponse conserve `id`, `reference`, `token`, `checkoutPageUrlWithPaymentToken` et `transactionStatus`. Les sorties de fonds seront laissées hors activation tant que la référence officielle Payout/cash-out du projet marchand n’est pas confirmée.

Le webhook reçu sur une URL HTTPS vérifie `x-webhook-hash` contre le corps JSON brut. Le payload Checkout fournit notamment `paymentIntentId`, `reference`, `transId`, `paymentAmount` et `paymentStatus` (`DONE` ou `FAILED`). Le montant minimal affiché par la documentation est de 100 FCFA. Le client ouvre uniquement `checkoutPageUrlWithPaymentToken`, sans recevoir de clé API ; le webhook est la source de vérité métier et doit être idempotent par `transId` ou `paymentIntentId`.

L’intégration Tikis doit créer les intentions côté serveur, ne jamais exposer la clé API au mobile, ne créditer le Wallet qu’après confirmation serveur authentifiée, et traiter les webhooks de manière idempotente.

## Paiement direct Mobile Money

Le paiement direct ne passe pas par `payment-intent/{projectId}` ni par une URL de checkout.
Le contrat Sandbox vérifié le 26 septembre 2026 est :

1. `POST /groups/{organizationId}/projects/{projectId}/direct-payment/init`
   avec `amount`, `reference` et `articles`.
2. La réponse contient `paymentIntentId`, `expiresAt` et `availableOperators`.
   Les codes opérateurs sont `ORANGE` et `MOOV` — ils ne doivent pas être remplacés par
   `orange_money` ou `moov_money` dans les requêtes YengaPay.
3. Pour `MOOV` (`flow: TWO_STEP`), appeler
   `POST /direct-payment/send-otp` avec `paymentIntentId`, `operatorCode`, `countryCode`
   et `customerMSISDN`. Le client saisit ensuite l’OTP reçu par SMS.
4. Pour `ORANGE` (`flow: ONE_STEP`), afficher le `ussdCode` renvoyé par YengaPay afin que
   le client génère son OTP. Le client saisit ensuite cet OTP dans Tikis.
5. `POST /direct-payment/pay` reçoit `paymentIntentId`, `operatorCode`, `countryCode`,
   `customerMSISDN` et `otp`. Une réponse `status: DONE` confirme le paiement.
6. Le mobile reste dans Tikis pendant tout le parcours. Le serveur crédite le Wallet une
   seule fois après `DONE` ou après un webhook signé `payment.succeeded`.

Le statut peut aussi être relu avec l’endpoint d’intention existant pendant le polling.
Les montants, pays, opérateurs, OTP et références sont validés côté serveur avant tout appel.
