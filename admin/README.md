# Console d'administration Tikis

Application web séparée (React + Vite), servie par le même serveur Express que l'API Tikis, sous `/admin`. Elle ne fait pas partie du bundle mobile Expo.

## 1. Sessions de la console

Aucune variable d'environnement n'est nécessaire pour les sessions admin. Depuis la migration
`drizzle/manual/0044_admin_sessions.sql`, la console reçoit à la connexion un jeton aléatoire dans un cookie
httpOnly (`tikis_admin_session`, SameSite=Strict, chemin `/api`). La base n'en garde que l'empreinte SHA-256.
La déconnexion ou la suspension du compte révoque la session côté serveur. Une session dure 8 h au plus.

`TIKIS_ADMIN_SESSION_SECRET` n'est plus lu et peut être retiré du `.env`.

Si la console est servie depuis un autre sous-domaine que l'API (par ex. `admin.tikis.app`), cette origine
doit figurer dans `TIKIS_ALLOWED_ORIGINS` : le serveur n'accepte le cookie qu'accompagné de l'en-tête
`X-Tikis-Admin: 1`, qu'un navigateur n'envoie qu'aux origines autorisées par CORS.

## 2. Appliquer la migration base de données

```
mysql -u <user> -p <database> < drizzle/manual/0020_admin_console.sql
mysql -u <user> -p <database> < drizzle/manual/0044_admin_sessions.sql
```

(ou régénérez proprement via `pnpm drizzle-kit generate` une fois la connexion DB disponible — ce fichier manuel sert de référence immédiate.)

> **Déploiement TiDB.** Les tables de cette migration sont compatibles et ont été créées. TiDB ne prend toutefois pas en charge les triggers MySQL d’immuabilité du journal d’audit. La console n’expose aucune opération de modification ou de suppression de `tikis_admin_audit_log` ; pour une protection équivalente en production, utilisez également un compte de base de données dont les privilèges sur cette table sont limités à `INSERT` et `SELECT`.

## 3. Créer le premier compte super-admin

Aucune route d'inscription n'existe volontairement. Depuis la racine du projet :

```
node --import tsx scripts/create-admin-user.ts vous@kasotech.com "un mot de passe d'au moins 12 caractères" "Votre nom" super_admin
```

## 4. Builder la console admin

```
cd admin
npm install
npm run build
```

Cela génère `admin/dist/`, automatiquement servi par le serveur Express sous `/admin` (voir `server/_core/index.ts`). Aucune configuration supplémentaire n'est nécessaire : redémarrez simplement le serveur (`pnpm dev:server` ou votre process de prod) après le build.

## 5. Développement local de la console (hot-reload)

```
cd admin
npm run dev
```

Le serveur Vite proxifie `/api` vers `http://localhost:3000` (le serveur Tikis doit tourner en parallèle).

## Sécurité — points importants

- L'authentification admin est **totalement indépendante** de celle des Senders/Livreurs (pas d'OTP, mot de passe hashé en scrypt, session JWT courte de 8h).
- Un limiteur de tentatives bloque une adresse IP + e-mail après 5 échecs pendant 15 minutes (en mémoire — à faire évoluer vers un store partagé type Redis si l'API tourne sur plusieurs instances).
- Trois rôles : `super_admin` (tout, y compris gestion des comptes admin et journal d'audit), `finance` (peut modifier la commission), `support` (signalements, litiges, utilisateurs en lecture).
- Toute action sensible (modification du taux de commission, résolution d'un signalement, consultation d'un profil/litige, suspension d'un admin) est tracée dans `tikis_admin_audit_log`, protégé par les mêmes triggers d'immuabilité que le journal financier.
- Pensez à restreindre l'accès réseau à `/admin` (allowlist IP, VPN, ou reverse-proxy avec authentification supplémentaire) en plus de cette authentification applicative, avant toute exposition publique.
