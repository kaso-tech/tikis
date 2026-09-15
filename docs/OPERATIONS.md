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

## Migrations manuelles (`drizzle/manual/`)

Ces migrations ne sont **pas** appliquées par `drizzle-kit` : elles portent ce que drizzle-kit ne sait
pas générer (index, backfills, enums) et s'appliquent à la main, dans l'ordre des numéros.

**La base de production est TiDB, pas MySQL.** Compatible au niveau du protocole et de la majorité de
la syntaxe DDL/DML, mais **sans aucun support des triggers** — `CREATE TRIGGER` échoue avec une erreur
de syntaxe, TiDB ne reconnaît même pas la construction. Ce n'est découvert qu'à l'usage si on ne le
sait pas à l'avance : ni `db:check-schema` ni `tsc` ne peuvent le détecter, seule une tentative
d'application réelle le révèle. **Aucune migration de ce dossier ne doit créer de trigger**, même pour
un besoin qui semblerait le justifier (immuabilité d'un journal, par exemple) — passer plutôt par une
restriction de privilèges DB (`REVOKE UPDATE, DELETE ON <table> FROM '<app_user>'@'%';`), documentée
au cas par cas dans le fichier de migration concerné et dans `admin/README.md`.

**Ne jamais rejouer le dossier entier en aveugle.** Les migrations antérieures à 0034 font des
`ALTER TABLE ... ADD COLUMN` sans garde (0023, 0025, 0028, 0031, 0032…) : les repasser échoue sur
« Duplicate column name ». Ce n'est pas destructeur, mais ça interrompt le lot et brouille le
diagnostic. Il faut donc n'appliquer que les migrations réellement en attente, dans l'ordre.

Depuis 0034, les migrations sont écrites pour être **rejouables sans risque** (`IF NOT EXISTS`, gardes
sur `information_schema`, backfills filtrés) : celles-là peuvent être repassées sans dommage, ce qui
évite d'avoir à savoir précisément où l'on en est.

**Ne pas supposer que les migrations antérieures ont toutes été appliquées.** `db:check-schema` sans
`DATABASE_URL` ne fait qu'un contrôle statique (schéma du code ↔ fichiers de migration) — il peut
rendre « Aucun problème détecté » alors que la base réelle n'a jamais reçu certaines migrations.
Une vérification le 2026-09 sur l'environnement Manus a trouvé, en plus de 0034-0037, quatre
migrations plus anciennes jamais appliquées à cette base précise (`tikis_yengapay_webhook_events`,
`tikis_push_tokens`, `tikis_loyalty_programs`/`tikis_loyalty_grants`, `tikis_daily_metrics` absentes) —
sans lien avec le travail qui les a révélées. Avant toute nouvelle vérification, lancer
`DATABASE_URL=... pnpm db:check-schema` (contrôle live) plutôt que de se fier au résultat statique.

```bash
# N'appliquer que les fichiers en attente, dans l'ordre. Les 4 ci-dessous n'ont aucune dépendance
# entre elles (pas de clé étrangère) et sont sûres à rejouer si l'une d'elles était déjà appliquée.
for n in 0027_yengapay_webhook_events 0028_push_tokens 0029_loyalty_programs 0033_daily_metrics \
         0034_wallet_ledger_hardening 0035_places_coordinates_index 0037_driver_preferences; do
  f="drizzle/manual/${n}.sql"
  echo "→ $f"
  mysql -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < "$f" || { echo "ÉCHEC sur $f"; break; }
done
```

(`0036_rate_limits.sql` est omise de cette liste : déjà appliquée à l'environnement Manus au moment
où ce guide a été écrit — la repasser ne ferait rien de toute façon, `CREATE TABLE IF NOT EXISTS`.)

Vérifier ensuite que le schéma du code et celui de la base concordent :

```bash
pnpm db:check-schema        # statique
DATABASE_URL=... pnpm db:check-schema   # + contrôle live des tables réellement présentes
```

**Une table manquante ne se voit pas toujours tout de suite** : elle ne casse que le jour où le chemin
de code qui l'utilise est emprunté, et souvent de façon très large. Deux pannes totales de l'app ont eu
cette cause (`tikis_profile_sessions` en 0030, vérification de révocation à chaque requête protégée ;
`tikis_rate_limits` en 0036, compteur appelé avant chaque endpoint géographique). Les chemins concernés
sont désormais tolérants à l'absence de table, mais la protection réelle n'existe qu'une fois la
migration appliquée. Un cas moins visible mais plus grave : le webhook de paiement YengaPay
(`/api/webhooks/yengapay`, server/_core/index.ts) répond 400 au PSP si `tikis_yengapay_webhook_events`
est absente — un 400 se traite généralement comme un rejet définitif côté PSP, pas comme un signal
« réessaie plus tard ». Après tout déploiement, vérifier avec `DATABASE_URL=... pnpm db:check-schema`
(contrôle live, pas le statique) et appliquer les migrations manquantes signalées — jamais en
rejouant le dossier entier (voir plus haut).

## Backups DB

À planifier par l'opérateur via la console webdevtoken (section "Backups"). Requis :
- Sauvegarde quotidienne, conservée 30 jours.
- Test de restauration mensuel.

## Runbooks d'incident

Voir `docs/runbooks/` (à compléter au fil de l'eau).
