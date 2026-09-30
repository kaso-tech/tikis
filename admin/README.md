# Console d'administration Tikisse

Application web séparée (React + Vite), servie par le même serveur Express que l'API Tikisse, sous `/admin`. Elle ne fait pas partie du bundle mobile Expo.

## 1. Sessions de la console

Aucune variable d'environnement n'est nécessaire pour les sessions admin. La console reçoit à la connexion un jeton aléatoire dans un cookie
httpOnly (`tikisse_admin_session`, SameSite=Strict, chemin `/api`). La base n'en garde que l'empreinte SHA-256.
La déconnexion ou la suspension du compte révoque la session côté serveur. Une session dure 8 h au plus.

`TIKISSE_ADMIN_SESSION_SECRET` n'est plus lu et peut être retiré du `.env`.

### Double authentification (TOTP)

Chaque admin peut l'activer depuis « Mon compte » (QR code à scanner avec Google Authenticator,
Microsoft Authenticator, 1Password…). Elle exige une clé de chiffrement côté serveur, qui protège les
secrets TOTP stockés en base :

```
TIKISSE_ADMIN_TOTP_KEY=<chaîne aléatoire d'au moins 32 caractères, distincte des autres secrets>
```

Générez-la par exemple avec `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
Conservez-la précieusement : la perdre ou la changer oblige tous les admins à se réenrôler (un super-admin
réinitialise leur double authentification depuis « Équipe admin »).

Un super-admin peut ensuite la rendre obligatoire pour
les rôles super-admin et finance depuis « Équipe admin », une fois tous ces comptes enrôlés.

Si la console est servie depuis un autre sous-domaine que l'API (par ex. `admin.tikisse.app`), cette origine
doit figurer dans `TIKISSE_ALLOWED_ORIGINS` : le serveur n'accepte le cookie qu'accompagné de l'en-tête
`X-Tikisse-Admin: 1`, qu'un navigateur n'envoie qu'aux origines autorisées par CORS.

## 2. Base de données

La base est PostgreSQL (Supabase). Les tables de la console sont créées par les migrations communes à toute
l'application (`pnpm db:migrate`, voir docs/OPERATIONS.md). Le journal d'audit `tikisse_admin_audit_log` y est
rendu immuable par un déclencheur : aucune entrée ne peut être modifiée ni supprimée, même en SQL direct.

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

Le serveur Vite proxifie `/api` vers `http://localhost:3000` (le serveur Tikisse doit tourner en parallèle).

## Sécurité — points importants

- L'authentification admin est **totalement indépendante** de celle des Senders/Livreurs (pas d'OTP, mot de passe hashé en scrypt, session JWT courte de 8h).
- Un limiteur de tentatives bloque une adresse IP + e-mail après 5 échecs pendant 15 minutes (en mémoire — à faire évoluer vers un store partagé type Redis si l'API tourne sur plusieurs instances).
- Trois rôles : `super_admin` (tout, y compris gestion des comptes admin et journal d'audit), `finance` (peut modifier la commission), `support` (signalements, litiges, utilisateurs en lecture).
- Toute action sensible (modification du taux de commission, résolution d'un signalement, consultation d'un profil/litige, suspension d'un admin) est tracée dans `tikisse_admin_audit_log`, protégé par les mêmes triggers d'immuabilité que le journal financier.
- Pensez à restreindre l'accès réseau à `/admin` (allowlist IP, VPN, ou reverse-proxy avec authentification supplémentaire) en plus de cette authentification applicative, avant toute exposition publique.
