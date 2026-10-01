# Mise en service sur Supabase

Ce guide prépare un projet Supabase neuf pour Tikisse, puis vérifie le tout en une commande. Il ne
transfère pas les données de l'ancienne base : c'est l'étape suivante (voir la fin).

Durée : environ une heure, hors validation du fournisseur SMS.

---

## 1. Créer le projet

[supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.

- **Région** : `Central EU (Frankfurt)` ou `West EU (Paris)`, les plus proches de l'Afrique de l'Ouest.
- **Mot de passe de la base** : générez-le et conservez-le (gestionnaire de mots de passe). Il est dans
  `DATABASE_URL` et ne se récupère pas.
- **Offre** : l'offre gratuite **met le projet en pause** après une semaine sans activité et n'a pas de
  sauvegarde quotidienne. Pour la production, l'offre Pro.

## 2. Relever les accès

| Où dans Supabase | Quoi | Variable |
|---|---|---|
| Project Settings → API → Project URL | `https://<ref>.supabase.co` | `SUPABASE_URL` et `EXPO_PUBLIC_SUPABASE_URL` |
| Project Settings → API Keys → **Legacy API keys** → `anon` | clé publique | `EXPO_PUBLIC_SUPABASE_ANON_KEY` |
| Project Settings → API Keys → **Legacy API keys** → `service_role` | clé **secrète** | `SUPABASE_SERVICE_ROLE_KEY` |
| Connect → Connection string → **Transaction pooler** (port 6543) | adresse de la base | `DATABASE_URL` (+ `?sslmode=require`) |
| Connect → Connection string → **Session pooler** (port 5432) | adresse de la base | pour les migrations seulement (étape 4) |

Utilisez les clés **Legacy** (`anon`, `service_role`) : c'est avec elles que le serveur a été écrit et
testé. La clé `service_role` donne un accès total au projet : elle ne va que dans les variables du
serveur, jamais dans l'application, jamais dans un message ou un fichier commité.

## 3. Renseigner les variables

Le modèle complet, commenté, est dans [`.env.example`](../.env.example).

- **Serveur** (réglages de l'hébergeur) : toutes les variables sans préfixe `EXPO_PUBLIC_`.
  Trois secrets sont à générer, un par usage :
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
  pour `TIKISSE_SESSION_SECRET`, `TIKISSE_ADMIN_TOTP_KEY` et `CRON_SECRET`.
  Si l'ancien serveur avait déjà `TIKISSE_SESSION_SECRET` (ou `JWT_SECRET`) et `TIKISSE_ADMIN_TOTP_KEY`,
  **reprenez les mêmes valeurs** : sinon tous les utilisateurs sont déconnectés et chaque admin doit
  réactiver sa double authentification.
- **Application** (variables du build EAS / de l'export web) : les variables `EXPO_PUBLIC_*`.

## 4. Créer les tables

Automatique : Railway applique les migrations (`pnpm db:migrate`) avant chaque mise en service
(`railway.json`). Si une migration échoue, la nouvelle version n'est pas mise en ligne.

Elles créent les 32 tables, les données de référence (pays, programme de fidélité), rendent le journal
d'audit et le grand livre immuables, et ferment toutes les tables à l'API publique de Supabase (RLS).

À la main, depuis un poste qui a le projet (`pnpm install`) :

```bash
DATABASE_URL="<adresse Session pooler, port 5432>" pnpm db:migrate
```

## 5. Configurer le temps réel

1. Exécuter [`supabase/setup.sql`](../supabase/setup.sql), au choix :
   - `pnpm supabase:setup` (avec `SUPABASE_URL` et `SUPABASE_ACCESS_TOKEN`, jeton personnel créé dans
     Account → Access Tokens, à révoquer une fois la mise en service terminée) ;
   - ou **SQL Editor** → New query → coller le fichier → **Run**.
2. **Realtime → Settings** : désactiver **Allow public access**.

## 6. Connexion par téléphone et SMS

**Authentication → Sign In / Providers → Phone** : activer.

- Le serveur s'en sert aussi pour ouvrir la session temps réel de chaque utilisateur, même tant que les
  codes restent simulés. Sans elle, l'application fonctionne mais se met à jour par rafraîchissement
  périodique au lieu du temps réel.
- **Fournisseur SMS** (dans le même écran) : Supabase prend en charge Twilio, Twilio Verify, MessageBird,
  Vonage et Textlocal. Vérifiez chez le fournisseur la couverture du Burkina Faso (+226) et des autres pays
  actifs, et le prix par SMS. Twilio Verify gère lui-même codes et renvois.
- **Authentication → Rate Limits** : plafonner les SMS par heure (chaque SMS est facturé ; un robot peut en
  déclencher des milliers).
- Laisser les **inscriptions autorisées** (le serveur crée les comptes Supabase des utilisateurs Tikisse).

Tant que le fournisseur SMS n'est pas prêt : `TIKISSE_OTP_MODE=sim` (code de simulation, tests seulement).

## 7. Stockage

Rien à faire : le serveur crée au premier envoi de photo un bucket **privé** `tikisse-files`, limité aux
images de 8 Mo. S'il existe déjà et qu'il est public, le serveur refuse d'y déposer quoi que ce soit.

## 8. Vérifier

Avec les variables du serveur (fichier `.env` local, jamais commité, ou environnement) :

```bash
pnpm supabase:check
```

Contrôle les variables, la base (migrations, RLS, accès anonyme fermé, temps réel), la connexion par
téléphone et le bucket. Chaque problème est donné avec sa correction. Code de sortie 1 s'il reste un
point bloquant. Sans accès direct à la base (pare-feu), il passe par l'API de gestion de Supabase si
`SUPABASE_ACCESS_TOKEN` est défini.

## 9. Héberger le serveur sur Railway

Supabase n'héberge pas le serveur Tikisse (API Node.js toujours allumée, tâches planifiées, console
d'administration, version web). Railway le fait, depuis le dépôt GitHub. La configuration est dans
[`railway.json`](../railway.json) : build, migrations avant mise en service, démarrage, contrôle de santé
(`/api/health`), redémarrage automatique en cas de plantage.

1. [railway.com](https://railway.com) → **New Project** → **Deploy from GitHub repo** → `kaso-tech/tikisse`,
   branche `main`. Chaque mise à jour de `main` redéploie.
2. Service → **Settings** → **Region** : Europe (au plus près de la base Supabase).
3. Service → **Variables** : toutes celles de [`.env.example`](../.env.example), **y compris les
   `EXPO_PUBLIC_*`** : la version web de l'application est construite sur Railway et les intègre au build.
   Ajouter `DATABASE_MIGRATION_URL` = adresse **Session pooler** (port 5432) pour les migrations.
   Ne pas définir `PORT` : Railway le fournit.
4. Service → **Settings** → **Networking** → **Custom Domain** : `api.tikisse.app`, puis créer chez le
   registraire du domaine l'enregistrement CNAME indiqué par Railway. Le certificat HTTPS est automatique.
5. Déployer, puis vérifier `https://api.tikisse.app/api/health`.
6. Console YengaPay : webhook `https://api.tikisse.app/api/webhooks/yengapay`.

Une seule instance suffit au départ ; si vous en ajoutez, les tâches planifiées restent exécutées une seule
fois par créneau (voir docs/OPERATIONS.md).

## 10. Ensuite

1. **Transfert des données** depuis l'ancienne base et des fichiers depuis l'ancien stockage.
2. Recalcul des statistiques : `pnpm jobs:run compute-daily-metrics --days=366`.
3. **Vrais SMS** : `TIKISSE_OTP_MODE=real` (serveur) et `EXPO_PUBLIC_ENABLE_SUPABASE_PHONE_AUTH=true`
   (application), nouveau build de l'application.
