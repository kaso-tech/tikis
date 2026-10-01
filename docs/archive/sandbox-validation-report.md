# Rapport validation sandbox YengaPay

Date : 2026-09-25T21:53:48Z

## Résultats

### 1. validate-yengapay-sandbox.sh

- Variables d'env : OK (mode sandbox et credentials présents ; aucune clé secrète enregistrée dans le dépôt)
- Test credentials : PASSED
- Test checkout    : PASSED
- Test direct      : PASSED (Orange Money et Moov Money)

### 2. smoke-test webhook

- Scénario 1 (signature valide) : OK — HTTP 202
- Scénario 2 (signature KO)     : OK — HTTP 400
- Scénario 3 (event pending)    : OK — HTTP 202

### 3. Observations PSP

- Code USSD Orange observé/généré par le contrat courant : `*144*4*6*<montant>#`
- Code USSD Moov observé/généré par le contrat courant : `*555*4*<montant>#`
- Code HTTP pour succeeded : HTTP 202 sur le smoke test webhook local ; le test de checkout Sandbox a confirmé la création de l'intention sans crédit Wallet.
- Code HTTP pour failed : non déclenché par le smoke test ; le chemin de refus est couvert par les tests de contrat et le handler signé.
- Délai webhook après settle : non mesuré dans cette validation ; le smoke test local a répondu immédiatement.
- Anomalies logs serveur : aucune anomalie YengaPay bloquante observée ; une alerte historique de limite de watchers Expo a été résolue par le redémarrage avec cache propre. La suite globale a signalé séparément un échec du test `supabase-management-token.test.ts` (jeton Management API refusé ou projet non accessible), sans lien avec YengaPay ; 673 autres tests passent.

## Verdict

**GO** : intégration Sandbox validée pour les credentials, le checkout, les dépôts directs Orange/Moov et la vérification HMAC du webhook. La mise en production nécessite encore un projet YengaPay Live, des clés Live distinctes, un secret webhook Live et l'enregistrement de l'URL webhook de production.
