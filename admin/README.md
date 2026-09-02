# Console d'administration Tikis

Application web séparée (React + Vite), servie par le même serveur Express que l'API Tikis, sous `/admin`. Elle ne fait pas partie du bundle mobile Expo.

## 1. Variable d'environnement requise

Ajoutez dans le `.env` du serveur (racine du projet, à côté de `DATABASE_URL`) :

```
TIKIS_ADMIN_SESSION_SECRET=<chaîne aléatoire d'au moins 24 caractères, distincte de TIKIS_SESSION_SECRET et JWT_SECRET>
```

Générez-la par exemple avec :
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 2. Appliquer la migration base de données

```
mysql -u <user> -p <database> < drizzle/manual/0020_admin_console.sql
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
