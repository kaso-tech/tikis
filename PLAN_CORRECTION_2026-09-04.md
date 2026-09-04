# Plan de correction — Tikis

**Base** : `AUDIT_CONSOLIDE_2026-09-04.md`
**Décisions actées avec le porteur du produit (2026-09-04)** :
- Le système de confirmation du livreur (état `pending_confirmation` → `active`) a été ajouté **après** la rédaction de la spec métier d'origine. Ceci est la cause du déphasage relevé par l'audit sur le moment exact où la commission devient définitive et où les coordonnées deviennent visibles. Décision : la confirmation du livreur reste l'étape qui rend la commission définitive et les coordonnées visibles. Tant que le livreur n'a pas confirmé, **aucune conséquence financière** ne doit pouvoir se produire.
- Le Wallet d'un livreur n'est **jamais** crédité par une livraison (ni le prix, ni un "gain"). Les seules sources de crédit du Wallet sont : le rechargement par le livreur lui-même, les gains de parrainage, et un crédit envoyé par l'administrateur.
- Tous les points relevés par l'audit (les 5 constats critiques + tout ce qui a été relevé au-delà) sont à corriger. Ce document ordonne le travail par lots pour ne rien sauter.

Légende : ☐ à faire · ☑ fait · 🔶 en cours

---

## Phase 0 — Cadrage produit (acté, pas de code)
- ☑ Confirmation du livreur = étape qui rend commission + coordonnées définitives (pas la simple sélection).
- ☑ Wallet livreur jamais crédité par une livraison.

## Phase 1 — Cœur financier (correctifs critiques confirmés par l'utilisateur) — ☑ fait (2026-09-04)
Touchent tous `server/db.ts` autour de la sélection/remplacement/confirmation/complétion — traités ensemble pour rester cohérents.

1. ☑ **[Point 1 — bug]** Corrigé le double crédit lors du remplacement d'un candidat `selected` (jamais confirmé) : `selectTikisDeliveryCandidateWithWallet` distingue maintenant explicitement `selected` (simple déblocage via `releaseCandidateCommission`, aucune compensation) de `confirmed` (compensation réelle, logique inchangée), en se basant sur le statut réel du candidat précédent plutôt que sur `delivery.accruedCommission`. Un seul candidat reste actif par livraison après remplacement.
2. ☑ **[Point 4 — fonctionnalité manquante]** Ajouté `deliveries.unselectCandidate` (+ `unselectTikisDeliveryCandidateFromSender` côté serveur) : le Sender peut annuler son choix avant la confirmation du livreur, sans aucune incidence financière (déblocage intégral de la commission réservée, candidat remis à `applied`, livraison remise à `open`). Bouton ajouté côté UI (`app/delivery/[id].tsx`, visible pendant le suivi live pour le Sender quand le statut est `pending_confirmation`).
3. ☑ **[Point 2 — divergence de modèle économique]** Supprimé tout crédit du prix de la livraison au Wallet du livreur (`completeTikisDeliveryWithEvents` et la branche d'auto-complétion à 24 h dans `expireOpenTikisDeliveries`). Ajouté `getDriverCompletedDeliveryEarnings` (+ route `wallet.driverEarningsHistory`) qui calcule l'affichage "Gains" à partir des livraisons terminées, jamais du Wallet. Écrans mis à jour : `app/(tabs)/earnings.tsx`, `components/tikis/screens/home-screen.native.tsx`, `components/tikis/screens/home-screen.web.tsx` (`app/(tabs)/wallet.tsx` n'avait pas besoin de changement : son usage de `deliveryMetricsForDay` mesure l'activité Wallet réelle, pas les gains).
4. ☑ Ajouté la vérification serveur de `confirmedCommission` dans `applyForTikisDelivery` : rejet explicite si le montant envoyé par le client ne correspond plus au montant recalculé côté serveur (taux changé entre-temps).
5. ☑ Corrigé le texte du popup de sélection dans `app/delivery/[id].tsx` pour refléter fidèlement que la commission et la visibilité des coordonnées ne deviennent définitives qu'à la confirmation du livreur, et que le choix reste annulable sans frais jusque-là.
6. ☑ Mis à jour `tests/delivery-lifecycle-contract.test.ts` pour vérifier l'absence de crédit Wallet lié à une livraison et la présence du nouveau calcul informatif. Suite complète revérifiée (`npx vitest run`) : aucune régression introduite (les échecs restants sont environnementaux — DB/réseau/env vars absents du bac à sable — déjà présents avant ces changements).

## Phase 2 — Fiabilité transactionnelle et reporting admin — ☑ fait (2026-09-04)
7. ☑ **[C3 finance]** `adminAdjustWallet` accepte désormais une transaction (`tx`) optionnelle fournie par l'appelant au lieu d'en ouvrir systématiquement une nouvelle : `adminForceCancelDelivery` (boucle sur les candidats) et `adminRewardReferral` (crédit + changement de statut) s'exécutent maintenant dans une seule transaction atomique. Clés d'idempotence déterministes partout : `${deliveryId}:admin-force-cancel:${candidateId}`, `${referralId}:admin-reward`. Pour les actions libres sans entité naturelle (`reward`/`penalize`/`sendBonus`), un `requestId` (UUID) généré une seule fois côté client (`admin/src/pages/UsersPage.tsx`, `FinancePage.tsx`) est propagé jusqu'à la clé d'idempotence — un double-clic ou une relance réseau ne peut plus produire un second mouvement réel.
8. ☑ **[C4 finance]** Migration `drizzle/manual/0034_wallet_ledger_hardening.sql` : ajoute les triggers `BEFORE UPDATE`/`BEFORE DELETE` manquants sur `tikis_wallet_ledger` (même logique que `tikis_admin_audit_log`).
9. ☑ **[C5 finance]** Nouveau type d'opération `commission_debit`, distinct du `debit` générique (retraits) — enum Drizzle + migration (avec backfill de l'historique existant), `confirmTikisDeliveryWithEvents` l'utilise pour le vrai prélèvement de commission. `adminDashboardMetrics.commissionRevenue` et le calcul "Ce mois" de `app/(tabs)/wallet.tsx` filtrent maintenant sur ce type dédié — un retrait n'est plus compté comme du revenu Tikis.
10. ☑ **[H2 finance — reclassé]** Confirmé : remplacer un livreur déjà `active` (confirmé) est un cas légitime de compensation réelle, couvert par le même correctif que le point 1 (`computeReplacementSettlement`, branche `"compensate"`) — aucune restriction de statut supplémentaire n'était nécessaire.
11. ☑ **[M5 finance]** `adminGetFinanceSettings` réutilise `db.getTikisCommissionRate()` (même validation stricte que le taux réellement appliqué) au lieu d'un défaut silencieux à 10 %.
12. ☑ **[M1/M4 finance]** Bloc mort inatteignable supprimé de `cancelTikisDeliveryFromSender`. `platformTopUp` documenté comme décision produit assumée et intrinsèquement borné (commission déjà plafonnée à la candidature).
13. ☑ **[M3 finance]** La logique de remplacement (déblocage vs compensation réelle) est extraite dans une fonction pure testable (`computeReplacementSettlement`, `shared/wallet-commission.ts`), consommée par `server/db.ts` et couverte par un test comportemental réel (`tests/replacement-settlement.test.ts`, 6 cas dont la régression exacte du bug de double crédit) — remplace le test de contrat qui ne faisait que chercher des sous-chaînes dans le code source.
14. ☑ **[B1 finance]** `requestTikisWalletOperation` accepte un `requestId` déterministe fourni par l'appelant au lieu de `randomUUID()` interne.

Suite complète revérifiée (`npx tsc --noEmit`, `npx vitest run`) : aucune erreur ni régression introduite (mêmes 3 erreurs TS pré-existantes hors périmètre `admin/`, mêmes 6 échecs de test environnementaux déjà présents avant ces changements).

**Note pour la mise en production** : la migration `0034_wallet_ledger_hardening.sql` doit être appliquée manuellement (`mysql -u <user> -p <database> < drizzle/manual/0034_wallet_ledger_hardening.sql`), comme les autres fichiers de `drizzle/manual/`.

## Phase 3 — Gestion des lieux
15. ☐ **[Point 3 — bug régression « Maison du Peuple »]** Restaurer `featureType`/`precision` de bout en bout (schéma `placeSchema`, `toPlacePayload`, `saveDeliveryPlace`, `geography.savePlace`) pour ne plus jamais perdre la classification POI à l'écriture.
16. ☐ **[H-1 lieux]** Faire consommer `formatListRouteParts`/`locationTitle` par `map-preview.native.tsx`/`.web.tsx` (légende de la mini-carte).
17. ☐ **[H-2 lieux]** Supprimer le code mort de sélection de lieu (`place-sheets.tsx`, `place-picker.*`), migrer `SavedFavorite` vers `shared/tikis-domain.ts`.
18. ☐ **[H-3 lieux]** Arrondir la clé de cache de géocodage inverse à 5 décimales + seuil de déplacement minimal avant nouvelle résolution.
19. ☐ **[M-1/M-2/M-3 lieux]** Sanitization serveur des libellés, décision documentée sur `ensureCountry`, dédup par proximité des lieux manuels.

## Phase 4 — Workflow, notifications, temps réel
20. ☐ **[Point 5 — W-C1]** Notifier les livreurs compatibles à la publication/réactivation d'une livraison.
21. ☐ **[Point 5 — W-C4]** Synchroniser candidatures/retraits/signalements en Realtime (broadcast + invalidation `deliveries.candidates` côté client).
22. ☐ **[W-H2/H3/H4]** Nettoyer l'infrastructure Realtime : filtrer les abonnements par appartenance réelle, supprimer la policy RLS morte, fusionner les canaux dupliqués (statut + position).
23. ☐ **[W-M1..M6]** Corriger le prix candidat affiché (taux en dur), brancher les pièces jointes de signalement, notification admin sur signalement, corriger `isOpenDeliveryFresh`, rendre visible aux candidats non retenus leur propre candidature, tracer côté serveur qu'un popup a bien été affiché.

## Phase 5 — Nettoyage transverse résiduel
24. ☐ Rate-limit géographique distribué (B-1 lieux).
25. ☐ Revue des points de sécurité générale déjà listés dans `AUDIT_RAPPORT_2026-09-03.md` (non repris dans l'audit du 09-04) pour confirmer leur statut actuel.

---

## Suivi
Ce fichier est mis à jour au fur et à mesure (cases cochées, notes d'écart) pour qu'aucun point de l'audit ne soit perdu de vue, y compris si le travail s'étale sur plusieurs sessions.
