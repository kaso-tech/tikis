# Tikisse — Guide des opérations

## Tâches planifiées

Le serveur les exécute lui-même (server/scheduled-jobs.ts) : rien à enregistrer dans une console externe.
Heures UTC (= heure du Burkina Faso).

| Tâche                        | Quand              | Ce qu'elle fait |
|------------------------------|--------------------|-----------------|
| `expire-deliveries`          | toutes les 10 min  | Clôture les courses actives depuis 24 h (crédite le livreur), expire celles jamais démarrées, notifie les parties. |
| `compute-daily-metrics`      | chaque jour 00:15  | Recalcule les statistiques des 7 derniers jours (`tikisse_daily_metrics`). |
| `finalize-account-deletions` | chaque jour 03:00  | Supprime les comptes au bout des 30 jours (sauf blocage), efface leurs fichiers, purge les correspondances de plus de 10 ans. |
| `expire-loyalty-grants`      | chaque jour 04:00  | Annule les bonus de fidélité non crédités arrivés à échéance. |

- **Une seule exécution par créneau**, même avec plusieurs serveurs : chacune est réservée en base
  (`tikisse_scheduled_job_runs`, qui sert aussi d'historique : statut, durée, résultat, erreur).
- **Rattrapage** : un créneau manqué (serveur arrêté à 3 h) est exécuté au redémarrage.
- **Échec** : retenté 15 minutes plus tard, 5 fois au plus. Une exécution restée « en cours » plus d'une heure
  (serveur arrêté au milieu) est reprise.
- `TIKISSE_SCHEDULER=off` désactive le planificateur sur une instance (par exemple une instance de secours) ;
  les autres continuent.

### Déclenchement à la main

```bash
CRON_SECRET=<secret du serveur> TIKISSE_API_URL=https://api.tikisse.app pnpm jobs:run expire-deliveries
CRON_SECRET=… pnpm jobs:run compute-daily-metrics --days=366   # recalcule jusqu'à un an d'historique
```

Les routes `POST /api/scheduled/<tâche>` exigent `Authorization: Bearer <CRON_SECRET>` (32 caractères au
moins) ; sans `CRON_SECRET` défini sur le serveur, elles répondent 503. Elles peuvent aussi servir à un
planificateur externe si l'hébergeur endort le serveur la nuit.

### Vérification de la santé

```bash
# Healthcheck global (rapide)
curl -s http://localhost:3000/api/health | jq

# Dernières exécutions des tâches planifiées
psql "$DATABASE_URL" -c 'select "jobName", slot, status, attempts, "finishedAt", error from tikisse_scheduled_job_runs order by "startedAt" desc limit 20'
```

## Base de données (PostgreSQL / Supabase)

`DATABASE_URL` pointe sur la base Postgres du projet Supabase. Prendre la chaîne du **pooler en mode
transaction** (Supabase → Project Settings → Database → Connection string → « Transaction pooler », port
6543), avec `?sslmode=require` :

```
DATABASE_URL=postgresql://postgres.<ref>:<mot de passe>@aws-0-<région>.pooler.supabase.com:6543/postgres?sslmode=require
DATABASE_POOL_MAX=10   # connexions par processus serveur (optionnel)
```

Le serveur désactive les requêtes préparées (`prepare: false`, server/db.ts), ce que ce mode exige.

### Migrations

```bash
pnpm db:migrate          # applique drizzle/migrations/* (idempotent : ne rejoue que ce qui manque)
pnpm db:check-schema     # tables présentes et RLS activée partout (avec DATABASE_URL : vérifie la base)
```

Pour une modification du schéma : éditer `drizzle/schema.ts`, puis `pnpm db:generate` écrit la migration SQL
dans `drizzle/migrations`. Toute nouvelle table doit y recevoir `ENABLE ROW LEVEL SECURITY`
(`tests/postgres-migration-contract.test.ts` le vérifie) : sans elle, l'API publique de Supabase la
lirait avec la clé `anon`, embarquée dans l'application.

Les migrations MySQL/TiDB d'avant le passage à Supabase restent dans `drizzle/mysql-legacy` pour
l'historique ; elles ne s'appliquent plus.

### Tests contre une vraie base

```bash
TIKISSE_TEST_DATABASE_URL=postgres://<user>:<mdp>@localhost:5432/<base_jetable> pnpm test
```

La base doit être jetable et migrée (`DATABASE_URL=<même url> pnpm db:migrate`). Jamais la base de production.

## Variables d'environnement sensibles

| Var                       | Usage                                          |
|---------------------------|------------------------------------------------|
| `TIKISSE_OTP_MODE`          | `sim` (defaut, OTP `730512`) ou `real` (OTP via provider SMS). |
| `TIKISSE_SIMULATION_OTP`    | Surcharge l'OTP en mode sim.                    |
| `YENGAPAY_API_KEY`        | Active YengaPay en mode live.                   |
| `YENGAPAY_ORG_ID`         | idem.                                           |
| `YENGAPAY_PROJECT_ID`     | idem.                                           |
| `YENGAPAY_WEBHOOK_SECRET` | Signature HMAC des webhooks entrants.           |
| `SENTRY_DSN`              | DSN Sentry (server).                            |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Realtime + stockage des fichiers. La clé `service_role` ne doit jamais quitter le serveur. |
| `SUPABASE_STORAGE_BUCKET` | Bucket des fichiers (défaut `tikisse-files`), créé privé au premier dépôt. |
| `CRON_SECRET`             | Déclenchement manuel des tâches planifiées (32 caractères au moins). |
| `TIKISSE_SCHEDULER`       | `off` pour désactiver le planificateur intégré sur une instance. |

## Stockage des fichiers (Supabase Storage)

Un seul bucket **privé** (`SUPABASE_STORAGE_BUCKET`, défaut `tikisse-files`), créé par le serveur au premier
dépôt, limité aux images (JPEG, PNG, WebP) de 8 Mo au plus. Le serveur refuse de déposer dans un bucket
public. Rien n'y est accessible directement :

- photos de profil : `GET /api/files/<clé>` redirige vers un lien signé valable 5 minutes ;
- pièces d'identité KYC et pièces jointes des signalements : jamais par cette route, seulement par la console
  (`/api/admin/documents/…`, session admin, rôle vérifié, consultation journalisée) ;
- suppression d'un compte : ses fichiers sont réellement supprimés du bucket.

L'ancienne adresse `/manus-storage/<clé>` est toujours servie de la même façon, pour une application installée
avant le changement.

## Logs

- Logs serveur : stdout JSON (à brancher sur Datadog/Loki/etc).
- Logs audit admin : table `tikisse_admin_audit_log` (consultable dans la console admin).
- Logs error : Sentry (configurer `SENTRY_DSN` en prod).

## Backups DB

Sauvegardes quotidiennes de Supabase (Project Settings → Database → Backups ; la restauration à un instant
précis, « PITR », est une option payante). Requis :
- Sauvegarde quotidienne, conservée 30 jours.
- Test de restauration mensuel.

## Runbooks d'incident

Voir `docs/runbooks/` (à compléter au fil de l'eau).
