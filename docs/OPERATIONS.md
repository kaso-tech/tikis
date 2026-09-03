# Tikis — Guide des opérations

## Crons planifiés

Trois crons doivent être enregistrés dans la console **webdevtoken.v1.WebDevService** (section "Scheduled jobs") :

| Cron                       | Schedule         | Endpoint                                          | Description |
|----------------------------|------------------|---------------------------------------------------|-------------|
| `expire-deliveries`        | `*/10 * * * *`   | `POST /api/scheduled/expire-deliveries`           | Finalise les livraisons actives depuis plus de 24 h, notifie les parties, et crédite les livreurs. |
| `finalize-account-deletions` | `0 3 * * *`     | `POST /api/scheduled/finalize-account-deletions`  | Supprime définitivement les comptes dont `deletionScheduledAt < now()` (suppression 30j après demande). |
| `expire-loyalty-grants`    | `0 4 * * *`      | `POST /api/scheduled/expire-loyalty-grants`       | Annule les `tikis_loyalty_grants` dont `status='pending'` ET `expiresAt < now()` (grants non crédités > 30j). |
| `compute-daily-metrics`     | `15 0 * * *`     | `POST /api/scheduled/compute-daily-metrics?days=7` | Calcule les métriques business des N derniers jours (GMV, commission, courses terminées) et les upsert dans `tikis_daily_metrics`. Param `days` entre 1 et 30. |

### Enregistrement initial (one-shot)

```bash
# 1. Afficher la liste + instructions
pnpm cron:register-all

# 2. (optionnel) Tester en local que les endpoints répondent
pnpm cron:register-all --ping
# → 403 cron-only est le comportement attendu sans token de service

# 3. Aller sur la console webdevtoken et enregistrer les 3 crons
#    avec le token isCron=true du service Tikis.
```

### Vérification de la santé

```bash
# Healthcheck global (rapide)
curl -s http://localhost:3000/api/health | jq

# Healthcheck cron (avec le token de service, en prod)
curl -X POST -H "Authorization: Bearer $CRON_TOKEN" \
     https://api.tikis.app/api/scheduled/expire-deliveries
```

## Variables d'environnement sensibles

| Var                       | Usage                                          |
|---------------------------|------------------------------------------------|
| `TIKIS_OTP_MODE`          | `sim` (defaut, OTP `730512`) ou `real` (OTP via provider SMS). |
| `TIKIS_SIMULATION_OTP`    | Surcharge l'OTP en mode sim.                    |
| `YENGAPAY_API_KEY`        | Active YengaPay en mode live.                   |
| `YENGAPAY_ORG_ID`         | idem.                                           |
| `YENGAPAY_PROJECT_ID`     | idem.                                           |
| `YENGAPAY_WEBHOOK_SECRET` | Signature HMAC des webhooks entrants.           |
| `SENTRY_DSN`              | DSN Sentry (server).                            |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Realtime + storage. |

## Logs

- Logs serveur : stdout JSON (à brancher sur Datadog/Loki/etc).
- Logs audit admin : table `tikis_admin_audit_log` (consultable dans la console admin).
- Logs error : Sentry (configurer `SENTRY_DSN` en prod).

## Backups DB

À planifier par l'opérateur via la console webdevtoken (section "Backups"). Requis :
- Sauvegarde quotidienne, conservée 30 jours.
- Test de restauration mensuel.

## Runbooks d'incident

Voir `docs/runbooks/` (à compléter au fil de l'eau).
