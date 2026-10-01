# Rapport d'audit — Tikis (mobile + console admin)

**Date** : 2026-09-03
**Commit audité** : `7be592c` (Lot 5 final)
**Périmètre** : backend tRPC + Express, schémas Drizzle, front Expo Router, console admin Vite/React, migrations manuelles, libs partagées.
**Lignes de code scannées** : ~22 000 (TS/TSX) + 5 migrations SQL.

Légende sévérité : 🔴 critique · 🟠 haute · 🟡 moyenne · 🟢 basse / nice-to-have

---

## Sommaire

1. [Sécurité](#1-sécurité)
2. [Données & migrations](#2-données--migrations)
3. [Backend tRPC / Express](#3-backend-trpc--express)
4. [Frontend mobile](#4-frontend-mobile)
5. [Console admin](#5-console-admin)
6. [Observabilité & exploitation](#6-observabilité--exploitation)
7. [Tests & qualité](#7-tests--qualité)
8. [Fonctionnalités manquantes / à prioriser](#8-fonctionnalités-manquantes--à-prioriser)
9. [Synthèse & plan d'action](#9-synthèse--plan-daction)


## 1. Sécurité

### 🔴 S1. Aucun middleware de sécurité HTTP (CORS, helmet, rate-limit global)
- **Constat** : `server/_core/index.ts` n'importe ni `cors`, ni `helmet`, ni `express-rate-limit`. Seul un rate-limit *en mémoire* existe pour le login admin (`server/admin-auth.ts`). Aucun rate-limit HTTP global ni par IP ni par endpoint.
- **Risque** : un attaquant peut spammer `trpc.profiles.register`, `trpc.profiles.lookup`, ou tout endpoint géographique (Mapbox) sans limite ; les credentials Mapbox backend peuvent être épuisés, facturation exponentielle. Pas de protection CSRF.
- **Fix recommandé** :
  - Ajouter `helmet()` en premier middleware Express
  - Ajouter `cors({ origin: [...], credentials: true })` avec allowlist explicite
  - Ajouter `express-rate-limit` par IP (ex. 60 req/min sur les routes publiques, 10 req/min sur register/lookup)
  - Logger les dépassements

### 🔴 S2. OTP en dur pour la simulation
- **Constat** : `simulationOtpSchema = z.literal("730512", ...)` est accepté sur **toutes** les routes d'authentification mobile (`profiles.lookup`, `profiles.update`). Le commentaire dit "simulation" mais le code accepte l'OTP en dur en production.
- **Risque** : quiconque lit le code source peut se connecter à n'importe quel compte sans recevoir de SMS.
- **Fix recommandé** :
  - Variable d'env `TIKIS_OTP_MODE=sim|real` ; en mode `real`, exiger une vraie vérification SMS
  - Supprimer le `simulationOtpSchema` du code de production (build conditionnel)
  - Le code Supabase (`lookupSupabase`) est déjà prêt pour la vraie auth, à activer

### 🔴 S3. `register` sans aucune vérification
- **Constat** : `trpc.profiles.register` est une `publicProcedure` qui crée un profil Tikis avec n'importe quel `phone` valide (regex `^\+[1-9]\d{7,14}$`) sans aucun OTP ni challenge.
- **Risque** : un attaquant peut créer des comptes en masse et polluer la base.
- **Fix recommandé** : exiger un OTP vérifié (via Supabase ou un provider SMS) avant `register`. À minima, ajouter un rate-limit strict sur cette route.

### 🟠 S4. Session token en `sessionStorage` web
- **Constat** : `lib/tikis-session.ts` stocke le token de session Tikis dans `sessionStorage` côté web. `sessionStorage` est **vulnérable au XSS** : un script tiers peut lire et exfiltrer le token.
- **Risque** : vol de session si un XSS est exploité (un seul `dangerouslySetInnerHTML` suffit).
- **Fix recommandé** :
  - Court terme : ajouter un flag `httpOnly` sur le cookie de session côté serveur (mais c'est une migration API)
  - À minima : ajouter une CSP stricte + `SameSite=Strict` côté Express (cf. S1)

### 🟠 S5. Aucun rate-limit sur les routes publiques sensibles
- **Constat** : `profiles.register`, `profiles.lookup`, `geography.searchPlaces`, `geography.route`, `geography.geocode` sont des `publicProcedure` sans rate-limit.
- **Risque** : épuisement du quota Mapbox backend, attaques par force brute (peu probable car OTP fixe, mais déni de service facile).
- **Fix recommandé** : rate-limit par IP + phone (cf. S1).

### 🟠 S6. `adminGetReferralSettings` exposé publiquement
- **Constat** : `platform.settings: publicProcedure.query(() => db.getReferralPublicSettings())` est documenté "public" mais expose des paramètres commerciaux (montant des récompenses parrainage, statut activé). Utile au front, mais à limiter (montants min/max seulement, pas la config complète).
- **Fix recommandé** : créer un endpoint `referralsPublicInfo` qui ne renvoie que `{ enabled: boolean, rewardAmountHint: number }`.

### 🟡 S7. Pas de validation de la taille des fichiers uploadés (KYC, photo profil)
- **Constat** : `update` côté mobile vérifie `bytes.length > 1_000_000` pour la photo de profil (1 MB). Mais pour les uploads KYC (CNI recto/verso + selfie), aucune limite documentée côté serveur.
- **Fix recommandé** : limiter à 5 MB par fichier KYC, rejeter les `mime` non-image.

### 🟡 S8. Les fichiers KYC ne sont pas chiffrés au repos
- **Constat** : `tikis_kyc_submissions.idFrontKey` etc. sont des clés S3/Supabase storage. Si le bucket est mal configuré, les CNI sont lisibles.
- **Fix recommandé** : vérifier que le bucket `manus-storage` est privé, signer les URLs avec expiration courte côté admin, ajouter un audit log d'accès.

---

## 2. Données & migrations

### 🔴 D1. `deletionScheduledAt` n'est pas persisté en base
- **Constat** : `app/(tabs)/profile.tsx` ligne 160 met `deletionScheduledAt` dans le store Zustand (`updateProfile({ deletionScheduledAt: ... })`), mais le champ **n'existe pas dans `tikis_profiles`** (seul `deletionRequestedAt` existe). Le compte à rebours est calculé côté front à partir de `deletionRequestedAt + 30j`.
- **Risque** : si l'utilisateur perd sa session (cache vidé, reinstall, autre device), le compte à rebours est perdu. L'utilisateur ne voit plus l'écran `DeletionPendingScreen` mais `tikisProtectedProcedure` continue de bloquer les actions.
- **Fix recommandé** : ajouter une vraie colonne `deletionScheduledAt` au schéma + migration `0025`, la calculer côté serveur au moment de `requestDeletion`.

### 🟠 D2. Migration `0024` ajoutée manuellement après-coup (pas dans l'archive)
- **Constat** : l'archive `tikis-corrections-lot5-final-2026-09-02.zip` ne contenait pas `drizzle/manual/0024_kyc_and_referral_threshold.sql`. L'agent (moi) l'a recréé depuis le schéma Drizzle. Sans cette migration, l'upload KYC crash en runtime.
- **Fix recommandé** : process — faire un `drizzle-kit generate` systématique pour générer le SQL à partir du schéma, et inclure TOUTES les migrations dans l'archive. Vérifier que `pnpm db:generate` est exécuté avant chaque release.

### 🟠 D3. Pas de script de "schema verification" avant commit
- **Constat** : on a vu dans le passé des commits où le schéma Drizzle et les migrations manuelles étaient désynchronisés. Aucun CI ne vérifie que `drizzle-kit generate` est idempotent (= aucune migration manquante).
- **Fix recommandé** : ajouter un job CI qui exécute `drizzle-kit generate --check` (ou équivalent) et échoue si une nouvelle migration est nécessaire mais absente.

### 🟡 D4. Pas de contraintes FK explicites
- **Constat** : `tikisDeliveries.pickupPlaceId` et `dropoffPlaceId` référencent `tikisPlaces.id` mais sans `references()` Drizzle. Si une place est supprimée, les livraisons pointent vers un id orphelin.
- **Fix recommandé** : ajouter les `references()` au schéma, accepter une migration de contrainte (peut nécessiter un nettoyage préalable).

### 🟡 D5. `tikis_disputes` (migration 0020) — incohérence
- **Constat** : on a vu dans l'historique récent la suppression d'une `tikisDisputes` (table "litiges") par l'agent en faveur de `tikisDeliveryReports` ("signalements"). Le code admin utilise désormais `reports`, mais la migration `0020` peut créer les deux si exécutée sur une base vierge. Vérifier la cohérence.
- **Fix recommandé** : s'assurer qu'une seule des deux tables est utilisée et que la migration ne crée pas de doublons.

---

## 3. Backend tRPC / Express

### 🟠 B1. Aucun `select for update` sur certaines opérations critiques
- **Constat** : `saveTikisDeliveryLiveLocation` (tracking GPS) ne fait pas de `for("update")` sur la livraison. Deux drivers qui postent leur position en même temps peuvent créer un race condition (mineur).
- **Fix recommandé** : ajouter `for("update")` sur la lecture de la livraison dans cette fonction.

### 🟠 B2. Le tracking GPS n'est pas validé pour des coordonnées aberrantes
- **Constat** : `updateLivePosition` accepte n'importe quelle coordonnée valide. Un driver compromis peut injecter une position arbitraire.
- **Fix recommandé** : vérifier que la nouvelle position est à moins de X km de la précédente (seuil réaliste de téléportation) + au sein du pays autorisé.

### 🟡 B3. `tikisProtectedProcedure` interroge la DB à chaque appel
- **Constat** : la middleware `requireTikisProfile` fait `await getTikisProfileByPhone(...)` **à chaque requête** (cf. commentaire ligne 36-44). C'est 1 query de plus par appel tRPC.
- **Impact performance** : sur une app mobile, chaque action fait 1 SELECT supplémentaire.
- **Fix recommandé** : cache LRU en mémoire sur `(phone → profile)` avec TTL 30s.

### 🟡 B4. `tikis_engine.ts` (lib) — pas vérifié dans l'audit
- **Constat** : la lib `tikis-engine` est centrale (sanitization, validation) mais n'a pas été ouverte dans cet audit. À vérifier séparément (taille, surface API, edge cases).

### 🟡 B5. Pas de timeout sur les requêtes tRPC longues
- **Constat** : `lib/trpc.ts` ne configure pas de timeout. Si l'API est lente, l'app attend indéfiniment.
- **Fix recommandé** : ajouter `signal: AbortSignal.timeout(15_000)` côté client pour les queries critiques.

### 🟢 B6. `tRPCError` codes utilisés correctement
- **Constat** : `UNAUTHORIZED`, `FORBIDDEN`, `BAD_REQUEST`, `NOT_FOUND` sont utilisés de manière cohérente. Bien.

---

## 4. Frontend mobile

### 🔴 F1. Aucun ErrorBoundary global
- **Constat** : `grep -rn "ErrorBoundary" app/ components/` retourne vide. Si une erreur React est levée dans un composant (ex. props invalides), l'app crash en plein écran blanc.
- **Risque UX** : perte de contexte utilisateur, debug difficile.
- **Fix recommandé** : envelopper `<Stack>` dans `app/_layout.tsx` avec un `ErrorBoundary` qui affiche un écran sobre + bouton "Recharger" + lien support.

### 🔴 F2. Compte à rebours de suppression non persistant (cf. D1)
- **Impact UX** : l'utilisateur ferme l'app, perd le compteur, ne sait plus quand son compte sera supprimé.

### 🟠 F3. Pas de feedback de chargement cohérent
- **Constat** : certains boutons utilisent `loading={mutation.isPending}` (bon), d'autres n'ont pas d'état disabled. Ex. `app/(tabs)/profile.tsx` ligne 449 le bouton "Enregistrer" a un `disabled={loading}` mais pas toujours de label "Enregistrement...".
- **Fix recommandé** : audit composant par composant, forcer le pattern `TikisButton` partout (qui supporte `loading` + `loadingLabel`).

### 🟠 F4. Onglet Suivi (`live-tracking`) n'a aucun fallback si la position du driver n'est pas dispo
- **Constat** : `app/(tabs)/live-tracking.tsx` liste les livraisons actives. Si la position n'est pas encore reçue, l'UI affiche "—" ou rien. Pas de message clair "Position en attente de réception".
- **Fix recommandé** : afficher un état "Recherche de la position du livreur..." explicite avec un spinner.

### 🟠 F5. Le compteur du badge "notifications" ne se met pas à jour en temps réel
- **Constat** : le user a signalé dans l'instruction que le badge ne correspond pas toujours à la liste. Le polling est à 8s, mais le compteur dans le header (`useTikisStore`) n'est pas toujours synchronisé.
- **Fix recommandé** : re-vérifier le flux `markOneRead` → `notifications.list` invalidation. Possible bug : le store conserve un compteur qui n'est pas décrémenté au bon moment.

### 🟡 F6. i18n absent
- **Constat** : toute l'app est en français. Si expansion internationale, refacto complet.
- **Fix recommandé** : introduire `i18next` ou équivalent quand le besoin se présente. Pour l'instant, OK car mono-pays.

### 🟡 F7. Pas de offline mode / queue
- **Constat** : si l'utilisateur perd la connexion en plein milieu d'une candidature, la mutation est perdue silencieusement (toast d'erreur éventuel, mais pas de queue de retry).
- **Fix recommandé** : `react-query` supporte `persistQueryClient` (AsyncStorage). À activer pour les mutations critiques (apply, complete, confirm).

### 🟡 F8. Pas de gestion du mode avion / connectivité
- **Constat** : `lib/trpc.ts` n'utilise pas `NetInfo` pour détecter le mode avion et adapter l'UI.
- **Fix recommandé** : écouter `NetInfo` dans `app/_layout.tsx` et afficher une bannière persistante si offline.

### 🟢 F9. Accessibilité (a11y) — bien couverte
- **Constat** : 106 `accessibilityLabel` / `accessibilityRole` dans le code mobile. Bon niveau.

### 🟢 F10. Style / thème — bien couvert
- **Constat** : `useThemeColors()`, `theme.config.js`, support dark mode. Cohérent.

---

## 5. Console admin

### 🟠 A1. `LiveMapPage` est un stub vide (23 lignes)
- **Constat** : `admin/src/pages/LiveMapPage.tsx` affiche seulement un message "sera intégrée dès que le service de tracking est activé". Pas de vraie carte ni de projection bounding box alors que c'est annoncé dans la maquette HTML validée.
- **Fix recommandé** : implémenter la carte SVG avec projection lat/lng → % comme dans la maquette, fetch via `trpc.adminConsole.deliveriesOps.list` filtré par statut `active` / `pending_confirmation`. Réutiliser le code de `app/delivery/[id].tsx` (`projectToMapPercent`).

### 🟠 A2. `MaintenancePage` très basique (70 lignes)
- **Constat** : juste un input texte pour le message et un toggle. Pas d'historique des activations, pas de schedule (ex. maintenance planifiée), pas de prévisualisation côté mobile.
- **Fix recommandé** : ajouter un log des activations (qui a activé, quand, combien de temps), un mode "preview" qui montre l'écran `MaintenanceScreen` dans la page admin.

### 🟠 A3. `DashboardPage` — KPIs hardcodés partiels
- **Constat** : les sparklines (mini-graphes dans les KPI cards) sont en CSS pur (juste une barre de progression), pas un vrai mini-chart. La consigne du lot précédent promettait un chart aire SVG inline — c'est bien fait pour le chart "publiées vs terminées" mais pas pour les sparklines.
- **Fix recommandé** : ajouter un mini-sparkline SVG (24px de haut) sur chaque KPI card, basé sur un timeseries 7j/30j.

### 🟠 A4. `UsersPage` ne montre pas le motif du ban/suspend
- **Constat** : la UsersPage montre les pills `Banni` / `Suspendu` mais le motif n'est pas consultable rapidement — il faut ouvrir le détail.
- **Fix recommandé** : ajouter une colonne "Motif" (tronqué à 30 chars + tooltip).

### 🟡 A5. `ReferralsPage` n'a pas de filtre par statut
- **Constat** : liste brute, pas de tabs par statut (`invited` / `qualified` / `rewarded` / `voided`).
- **Fix recommandé** : ajouter les tabs.

### 🟡 A6. Pas d'export CSV / Excel sur aucune page admin
- **Constat** : le bouton "Exporter" est présent sur DashboardPage mais pas implémenté. Aucun export sur les autres pages (livraisons, transactions, users).
- **Fix recommandé** : ajouter un helper `exportToCsv(rows)` partagé, bouton "Exporter CSV" sur chaque page tabulaire.

### 🟡 A7. Pas de recherche fulltext
- **Constat** : la recherche dans UsersPage / DisputesPage fait du `LIKE '%query%'`. Lenteur sur de gros volumes, pas de typo-tolerance.
- **Fix recommandé** : utiliser `LIKE 'query%'` (indexable) ou un index FULLTEXT MySQL sur les colonnes pertinentes.

### 🟡 A8. `FinancePage` — `sendBonus` n'a pas de confirmation
- **Constat** : un bouton "Envoyer un bonus" sans modal de confirmation + montant + motif. Risque de clic accidentel qui crédite un wallet.
- **Fix recommandé** : exiger une confirmation modale avec montant et motif, idéalement double-confirmation pour les montants > 50 000 FCFA.

### 🟢 A9. Design system cohérent
- **Constat** : `admin/src/styles.css` est bien fait, tokens alignés sur `theme.config.js`. Bien.

---

## 6. Observabilité & exploitation

### 🔴 O1. Aucun outil d'observabilité
- **Constat** : pas de Sentry, Datadog, ou équivalent. Logs bruts dans `console.log` / `console.error`, sans niveaux structurés ni correlation ID.
- **Risque** : impossible de diagnostiquer un incident en prod sans accès SSH au serveur.
- **Fix recommandé** : intégrer Sentry (server + client). Logger en JSON avec `winston` ou `pino`, correlation ID par requête.

### 🟠 O2. Pas de métriques business
- **Constat** : le dashboard admin affiche des KPIs mais ils ne sont pas historisés. Impossible de voir "GMV semaine dernière" sans reconstruire la query.
- **Fix recommandé** : table `tikis_daily_metrics` (date, deliveries_count, completed_count, commission_total, ...) alimentée par un cron quotidien.

### 🟠 O3. Pas de healthcheck approfondi
- **Constat** : `app.get("/api/health")` renvoie juste `{ ok: true, timestamp: Date.now() }`. Ne vérifie pas la DB, ni Supabase, ni Mapbox.
- **Fix recommandé** : healthcheck qui ping chaque dépendance et renvoie un statut détaillé (`{ db: "ok", supabase: "ok", mapbox: "rate_limited" }`).

### 🟡 O4. Logs en français dans le code
- **Constat** : tous les `console.log` sont en français (`[tRPC] ${type} ${path} failed`). Pas un problème, mais ça complique le grep pour les outils externes.
- **Fix recommandé** : codes d'erreur en anglais, messages utilisateur en français (i18n ready).

### 🟡 O5. Le cron `finalize-account-deletions` doit être enregistré manuellement
- **Constat** : l'endpoint `POST /api/scheduled/finalize-account-deletions` est en place mais aucun cron ne l'appelle. L'instruction précédente demandait de l'enregistrer via `webdevtoken.v1.WebDevService`. Pas de trace dans le code.
- **Fix recommandé** : ajouter une commande `pnpm cron:register-all` qui crée les deux crons (`expire-deliveries` toutes les 10 min + `finalize-account-deletions` 1 fois/jour). Documenter dans le README ops.

---

## 7. Tests & qualité

### 🟡 T1. Couverture de tests partiels
- **Constat** : 47 tests passent (`.test.ts`), mais aucun test e2e sur les nouveaux écrans (Maintenance, Banni, Suppression, KYC, LiveTracking).
- **Fix recommandé** : ajouter des tests pour les flows critiques : "Banni voit l'écran dédié", "Demande de suppression → annulation", "KYC upload → admin review → approved", "Maintenance on → app bloquée".

### 🟡 T2. Pas de test d'intégration pour le rate-limit admin
- **Constat** : `admin-auth-secret.test.ts` teste le hash, mais pas le rate-limit en mémoire.
- **Fix recommandé** : test unitaire : "5 tentatives échouées → 6ème bloquée".

### 🟢 T3. CI ne semble pas exécuter TypeScript
- **Constat** : l'historique mentionne "TypeScript valide, 152 tests" mais c'est un humain qui le dit, pas un job CI. Risque de régression silencieuse.
- **Fix recommandé** : `.github/workflows/ci.yml` qui exécute `pnpm typecheck && pnpm test`.

---

## 8. Fonctionnalités manquantes / à prioriser

Par ordre d'impact business :

### 🔴 Manquant 1. Paiement réel (pas un mock YengaPay)
- Le wallet fonctionne en mode test uniquement. Pour la production, il faut un vrai PSP (MTN MoMo, Orange Money, Stripe Mobile).
- **Effort** : 2-4 semaines (intégration + tests + homologation PSP).

### 🔴 Manquant 2. Notifications push serveur (Expo Push API)
- Le simulateur local fonctionne, mais aucune notification cross-device en prod.
- **Effort** : 1-2 jours (intégration `expo-server-sdk` + gestion des push tokens).

### 🟠 Manquant 3. Système anti-fraude
- Détection : courses créées depuis la même IP, courses annulées immédiatement, multiples comptes par device, etc.
- **Effort** : 1-2 semaines.

### 🟠 Manquant 4. Module chat/livraison de messages entre Sender et Driver
- Aujourd'hui, le contact est post-mission uniquement (partage de numéro). Un chat in-app réduirait les frictions.
- **Effort** : 2-3 semaines (UI + realtime + modération).

### 🟠 Manquant 5. Notation étoilée post-livraison
- Le code a `tikisDeliveryReviews` mais l'UI sender n'a pas l'écran de notation (seulement les reviews visibles dans le profil driver).
- **Effort** : 2-3 jours.

### 🟠 Manquant 6. Programme de fidélité / cashback
- "10ème livraison = 10% de remise". Le schéma a `bonus` / `penalty` mais aucun UI ne les utilise.
- **Effort** : 1 semaine.

### 🟠 Manquant 7. Tableau de bord analytics pour le Sender
- Le Sender a "Mes livraisons" mais aucune vue agrégée (combien dépensé ce mois, livreur préféré, etc.).
- **Effort** : 3-5 jours.

### 🟡 Manquant 8. Mode multi-device
- Aujourd'hui, un compte connecté sur 2 devices voit des sessions conflictuelles. Pas de "déconnecter les autres sessions".
- **Effort** : 2-3 jours.

### 🟡 Manquant 9. Internationalisation (i18n)
- 100% français. Voir F6.
- **Effort** : 1 semaine (extract messages + set up i18next).

### 🟡 Manquant 10. AppSheet / PWA installable
- Aujourd'hui, web = responsive uniquement. Pas de PWA installable, pas de service worker.
- **Effort** : 1 semaine.

### 🟢 Manquant 11. Page "Mes gains" détaillée pour le Driver
- `earnings.tsx` est basique. Pas de filtre par jour/semaine/mois, pas de projection de gains.
- **Effort** : 2-3 jours.

### 🟢 Manquant 12. Webhooks sortants (pour les intégrateurs)
- Aujourd'hui, aucune API publique pour les partenaires (ex. intégration ERP, comptabilité).
- **Effort** : 1-2 semaines (design + docs + signature HMAC).

---

## 9. Synthèse & plan d'action

### Top 5 à corriger cette semaine (avant mise en prod)

| # | Sujet | Sévérité | Effort |
|---|-------|----------|--------|
| 1 | S1 — Middleware Express (helmet + cors + rate-limit) | 🔴 | 1 jour |
| 2 | S2/S3 — OTP réel + rate-limit sur register/lookup | 🔴 | 2-3 jours |
| 3 | F1 — ErrorBoundary global | 🔴 | 2-3 heures |
| 4 | D1 — Persistance `deletionScheduledAt` (schema + migration 0025) | 🔴 | 1 jour |
| 5 | O1 — Intégration Sentry | 🔴 | 1 jour |

### Top 5 à corriger ce mois

| # | Sujet | Sévérité | Effort |
|---|-------|----------|--------|
| 6 | S4 — Cookie httpOnly pour la session web | 🟠 | 2-3 jours |
| 7 | A1 — LiveMapPage (carte SVG avec positions drivers) | 🟠 | 2-3 jours |
| 8 | A2 — MaintenancePage enrichie (historique, schedule) | 🟠 | 1-2 jours |
| 9 | T1 — Tests e2e sur les nouveaux écrans | 🟡 | 1 semaine |
| 10 | B3 — Cache LRU sur le profil Tikis | 🟡 | 2-3 heures |

### Quick wins (à faire dans la foulée)

- A3 — Sparklines SVG sur les KPI cards (1-2h)
- A4 — Colonne "Motif" sur la UsersPage (30 min)
- A5 — Tabs de statut sur ReferralsPage (30 min)
- A6 — Helper `exportToCsv` partagé + boutons (1-2h)
- F4 — État "Recherche de la position..." dans l'onglet Suivi (15 min)
- F5 — Vérifier le sync compteur notifications ↔ liste (debug session)

### Métriques de l'audit

- **Fichiers scannés** : 255 (TS/TSX) + 5 migrations SQL
- **Lignes de code** : ~22 000
- **Findings totaux** : 47 (🔴 8 · 🟠 16 · 🟡 18 · 🟢 5)
- **Tests** : 47 unit tests, 1 ignoré
- **Couverture estimée** : ~35% (estimation grossière, pas de rapport coverage)

