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

## Phase 3 — Gestion des lieux — ☑ fait (2026-09-04)
15. ☑ **[Point 3 — bug régression « Maison du Peuple »]** `featureType`/`precision` restaurés de bout en bout : `placeSchema` les accepte, `toPlacePayload` les transmet, `saveDeliveryPlace` et `geography.savePlace` (désormais un seul et même chemin d'écriture) les persistent au lieu de coder "unknown" en dur. Régression verrouillée par `tests/place-favorites-payload.test.ts`.
16. ☑ **[H-1 lieux]** `map-preview.native.tsx`/`.web.tsx` consomment maintenant `formatListRouteParts` pour la légende de la mini-carte, au lieu de `pickup.name`/`dropoff.name` bruts — la règle "Ville → Ville" s'applique désormais aussi dans la carte, pas seulement dans le texte à côté.
17. ☑ **[H-2 lieux]** Code mort supprimé : `place-sheets.tsx`, `place-picker.tsx`, `place-picker.native.tsx`, `place-picker.web.tsx`. Le type `SavedFavorite` vit maintenant dans `shared/tikis-domain.ts` (importé par `create-delivery.tsx`, `addresses.tsx`, `yango-address-picker.tsx`).
18. ☑ **[H-3 lieux]** Clé de cache de géocodage inverse arrondie à 5 décimales (~1,1 m, au lieu de 7 ≈ 1 cm). Ajout d'un seuil de 15 m dans `address-map-picker.native.tsx` : un drag de carte en dessous de ce seuil ne redéclenche plus d'appel Mapbox/OSM ni d'écriture DB.
19. ☑ **[M-1/M-2/M-3 lieux]** `saveDeliveryPlace`/`geography.savePlace` appliquent maintenant `sanitizePlaceText` sur tous les champs libres avant persistance. `ensureCountry` documenté comme décision produit assumée (blocage dur, conséquences connues). Dédup par proximité (50 m) des lieux manuels ajoutée (`findNearbyManualTikisPlace`) avec index de support (`drizzle/manual/0035_places_coordinates_index.sql`).

Suite complète revérifiée (`npx tsc --noEmit`, `npx vitest run`) : aucune régression (3 erreurs TS pré-existantes hors périmètre `admin/`, 6 échecs de test environnementaux déjà présents avant ces changements).

**Note pour la mise en production** : appliquer aussi `drizzle/manual/0035_places_coordinates_index.sql` (comme `0034_...` de la Phase 2).

## Phase 4 — Workflow, notifications, temps réel — ☑ fait (2026-09-04)
20. ☑ **[Point 5 — W-C1]** Les livreurs compatibles (engin correspondant, profil actif) sont notifiés à la publication (`deliveries.create`) et à la réactivation (`reactivate`) d'une livraison (`notifyCompatibleDriversOfDelivery`, bornée à 200 destinataires par défense). Le Sender devient aussi membre du canal Realtime dès la création (pas seulement à la première modification).
21. ☑ **[Point 5 — W-C4]** `submitApplication`, `withdraw` diffusent désormais un signal Realtime (comme `selectCandidate`/`confirm`/`complete`/`cancel` le faisaient déjà) ; `DeliveryRealtimeProvider` invalide maintenant aussi `deliveries.candidates` sur tout signal reçu — une feuille de candidatures déjà ouverte se met à jour sans rafraîchissement manuel.
22. ☑ **[W-H2/H3/H4]** `DeliveryRealtimeProvider` ne s'abonne plus qu'aux livraisons où le profil participe réellement (Sender, ou livreur assigné) au lieu de toutes les livraisons "open" compatibles. `supabase/realtime_policies.sql` transformé en script de nettoyage de la policy JWT jamais câblée (une seule source de vérité RLS reste : `realtime_auth_phone_rls.sql`). Statut et position partagent maintenant un seul channel Supabase par livraison (`subscribeToDeliveryChannel`, `lib/supabase-tracking.ts`) au lieu de deux souscriptions indépendantes au même topic.
23. ☑ **[W-M1..M5]** Prix candidat basé sur le prix réel de la livraison (`deliveryPrice`) au lieu de `commissionBlocked × 10` (taux en dur). Pièces jointes de signalement branchées de bout en bout (sélection photo, upload, `attachmentKey`). Badge de notification réel (sondage 30 s) sur les signalements ouverts dans la console admin, remplaçant le point statique jamais alimenté. `isOpenDeliveryFresh` (nommée/implémentée à l'envers, code mort) supprimée. Un candidat non retenu retrouve désormais sa propre candidature dans `deliveries.list` même après qu'un autre livreur a été sélectionné.
   - **[W-M6 — décision documentée, non implémentée]** Tracer côté serveur qu'un popup de confirmation a bien été affiché avant chaque action financière nécessiterait un nouveau mécanisme (jeton de confirmation signé par écran, vérifié à la mutation) : une vraie fonctionnalité, pas un correctif ponctuel. Non fait dans cette passe — l'autorisation métier reste correctement vérifiée côté serveur pour chaque mutation (ce n'est pas une vulnérabilité isolée, cf. audit), seule la preuve a posteriori en cas de litige manque. À reprendre si un besoin explicite se présente.

Suite complète revérifiée (`npx tsc --noEmit`, `npx vitest run`) : aucune régression (3 erreurs TS pré-existantes hors périmètre `admin/`, 6 échecs de test environnementaux déjà présents avant ces changements).

## Phase 5 — Nettoyage transverse résiduel
24. ☐ Rate-limit géographique distribué (B-1 lieux).
25. ☐ Revue des points de sécurité générale déjà listés dans `AUDIT_RAPPORT_2026-09-03.md` (non repris dans l'audit du 09-04) pour confirmer leur statut actuel.

---

## Suivi
Ce fichier est mis à jour au fur et à mesure (cases cochées, notes d'écart) pour qu'aucun point de l'audit ne soit perdu de vue, y compris si le travail s'étale sur plusieurs sessions.
