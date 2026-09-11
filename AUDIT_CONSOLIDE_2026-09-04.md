# Audit consolidé Tikis — Lieux, Workflow de livraison, Wallet/Commission

**Date** : 2026-09-04
**Commit audité** : `ab522ff` (branche `claude/bonjour-0yo56s`)
**Méthode** : 3 audits indépendants en parallèle, chacun confrontant le code réel aux deux spécifications métier fournies (« Gestion des lieux Tikis » et « Logique métier — Livraisons et Commissions »), lecture seule, aucune modification de code. Ce document consolide et met en relation leurs résultats.

Légende sévérité : 🔴 Critique · 🟠 Haute · 🟡 Moyenne · 🟢 Basse

---

## Résumé exécutif

L'application a déjà fait l'objet de plusieurs refontes visibles (centralisation du formatage des lieux, autorisation par session, cache géographique, versionnement des clés d'idempotence côté candidature). Ces efforts sont réels et globalement solides. Mais l'audit met au jour **un problème structurel non documenté auparavant** qui explique à lui seul plusieurs bugs critiques distincts trouvés par deux audits indépendants :

> **Le code introduit un état intermédiaire `pending_confirmation` (« livreur sélectionné mais pas encore confirmé ») que la spécification métier ne prévoit pas.** Dans la spec, la sélection d'un livreur = mise en relation actée = commission définitivement acquise = coordonnées visibles, en une seule étape. Dans le code, ces trois conséquences sont repoussées à une étape ultérieure et distincte (« confirmation du livreur »), créant une fenêtre où l'état du système est ambigu — et c'est précisément dans cette fenêtre que se produit le bug financier le plus grave de l'audit.

**Les 5 constats à traiter avant toute mise en production avec de l'argent réel :**

1. **🔴 Fuite de fonds reproductible à coup sûr** — remplacer un livreur « sélectionné » (pas encore confirmé) crédite deux fois sa commission bloquée et laisse deux candidats actifs simultanément sur la même livraison (trouvé indépendamment par les deux audits Finance et Workflow — voir §3.1).
2. **🔴 Divergence de modèle économique** — le **prix total** de la livraison (pas seulement la commission) est crédité comme argent réel et retirable sur le Wallet du livreur à chaque livraison terminée, alors que la spec dit explicitement que Tikis ne gère jamais ce paiement (§3.2).
3. **🔴 Régression silencieuse sur l'exemple métier n°1 de la spec des lieux** — la classification « nom de lieu public » (POI) d'un lieu comme « Maison du Peuple » est perdue dès qu'il est sauvegardé via le flux de recherche communautaire, cassant le libellé attendu à toute relecture ultérieure (§1.1).
4. **🔴 Fonctionnalité métier explicitement requise et totalement absente** — « Annuler le choix du livreur » (revenir à « sans livreur », différent de « remplacer » et de « annuler la livraison ») n'existe nulle part dans le code ni l'UI (§2.1).
5. **🔴 Le cœur du modèle de mise en relation repose sur du polling, pas sur du temps réel** — aucune notification aux livreurs compatibles à la publication d'une livraison, aucune synchronisation Realtime des candidatures/retraits alors que l'infrastructure Supabase Realtime existe déjà et est utilisée ailleurs (§2.2, §2.3).

Au-delà de ces 5 points, plusieurs opérations admin déplacent de l'argent sans transaction atomique unique ni idempotence réelle, un trigger d'immuabilité documenté pour le journal financier n'a en réalité jamais été créé, et du code mort coexiste par endroits avec la logique active — avec un risque concret de réactivation accidentelle.

---

## 1. Gestion des lieux (GPS, libellés, cache)

### 🔴 C-1. La classification POI d'un lieu est perdue à l'écriture pour les lieux issus de la recherche communautaire — casse l'exemple-phare de la spec

Le formatage est bien centralisé dans `lib/geo-rules.ts` et consommé par la quasi-totalité des écrans (`shared/tikis-domain.ts` le ré-exporte) — c'est un point fort confirmé. Mais le chemin d'écriture ne suit pas la même discipline.

- `lib/place-favorites.ts:25-40` (`toPlacePayload`) ne transmet jamais `featureType`/`precision`.
- `server/routers.ts:196` (`placeSchema`) n'accepte même pas ces champs en entrée.
- `server/routers.ts:227-244` (`saveDeliveryPlace`) et `:487` (`geography.savePlace`) écrivent en dur `featureType: "unknown", precision: "unknown"`.
- Le flux normal (`resolve`/`reverse`, `server/geography.ts:97-105`, `rememberResolvedPlace`) préserve correctement la classification — mais le flux de secours « élargir aux commerces connus » (fallback OpenStreetMap/Mapbox direct pour les lieux informels non indexés, `yango-address-picker.tsx:101`, `directLocation`) l'attache déjà classifiée en mémoire (`server/geography.ts:199-214`, `locationToDirectSuggestion`) **sans jamais repasser par `resolve`/`reverse`** avant la création de livraison ou l'ajout en favori.

**Scénario concret** : un expéditeur cherche « Maison du Peuple » (lieu informel, absent de l'index Mapbox Suggest), utilise le fallback communautaire, crée directement la livraison. Le lieu est enregistré avec `featureType: "unknown"`. `lib/geo-rules.ts:73-75` (`isPublicPlaceName`) ne traite plus jamais ce lieu comme un nom de lieu public à la relecture (liste, détail, tracking, notifications) : le libellé attendu par la spec (« Maison du Peuple → Stade du 4 Août ») ne s'affichera plus jamais pour ce lieu une fois persisté. Les tests actuels (`tests/geo-rules.test.ts`, `tests/location-presentation.test.ts`) ne couvrent que `featureType: undefined`, jamais `"unknown"` — la régression est donc invisible en CI.

**Recommandation** : propager `featureType`/`precision` de bout en bout (schéma + payload + fonctions d'écriture), ou forcer un passage par la logique de résolution/classification avant toute persistance d'un `directLocation`.

### 🟠 H-1. La légende de la mini-carte contourne le formateur centralisé — viole « Ville → Ville » dans le même écran que le texte qui le respecte

`components/tikis/map-preview.native.tsx:66-78` et `.web.tsx:91-104` affichent `pickup.name`/`dropoff.name` bruts dans la légende intégrée à `DeliveryCard`, juste au-dessus du texte qui, lui, utilise correctement `formatListRouteParts` (`components/tikis/delivery-card.tsx:23,92,99`). Pour un trajet Ouagadougou → Koudougou, le texte affichera correctement les deux villes tandis que la légende de la carte peut afficher un quartier/POI — deux libellés différents pour le même trajet, dans le même composant.

**Recommandation** : faire consommer `formatListRouteParts`/`locationTitle` par les deux fichiers `map-preview.*`.

### 🟠 H-2. Deux systèmes de sélection de lieu coexistent, l'un mort

`components/tikis/place-sheets.tsx` (`FloatingPlacePicker`, `FavoritePlacesSheet`) et `place-picker.{tsx,native.tsx,web.tsx}` ne sont importés nulle part dans l'app active (`YangoAddressPicker` + `AddressMapPicker` + `SaveAddressDialog` sont le seul chemin réellement utilisé). Seul le type `SavedFavorite` de `place-sheets.tsx` est encore consommé. Risque : toute évolution future de la logique de sélection appliquée uniquement au chemin actif laisse cet autre chemin dériver silencieusement, avec le risque qu'il soit un jour réactivé par erreur.

**Recommandation** : supprimer les 4 fichiers morts, déplacer `SavedFavorite` vers `shared/tikis-domain.ts`.

### 🟠 H-3. Le cache de géocodage inverse (clé à 7 décimales) est quasi inopérant pour son cas d'usage principal

`server/db.ts:223-228` (`coordinateCacheKey`) arrondit à 7 décimales (~1 cm). Le drag de carte (`address-map-picker.native.tsx:62-66`, déclenché à chaque relâchement) ne retombe quasiment jamais exactement sur la même clé : chaque petit ajustement redéclenche un appel Mapbox reverse (et potentiellement le fallback OSM), et crée une nouvelle ligne `tikis_places` à chaque fois. C'est le problème documenté par l'audit du 27/08 (recommandation : 5 décimales, ~1 m) — le mécanisme de cache existe désormais, mais sa granularité le rend inefficace en pratique, et alimente indirectement C-1 (chaque nouvelle ligne créée hors flux `reverse` recommence à `"unknown"`).

**Recommandation** : clé de cache arrondie à 5 décimales + seuil de déplacement minimal (~15 m) avant nouvelle résolution.

### 🟡 Moyenne
- **M-1** — `placeSchema` (server) ne sanitize jamais les chaînes libres (`sanitizePlaceText`/`normalizeLocation` existent mais ne sont appelés que côté client) : un appel API direct peut persister des libellés corrompus visibles par toute la communauté. *(`server/routers.ts:196`, `saveDeliveryPlace`)*
- **M-2** — `ensureCountry` bloque désormais strictement toute sélection hors du pays du profil (`server/geography.ts:107-114`), sans mécanisme de contournement ni décision produit documentée — risque de faux rejet en zone frontalière, et comparaison de chaînes fragile face aux variantes Unicode (apostrophes).
- **M-3** — Pas de fusion par proximité pour les lieux saisis manuellement (`server/db.ts:257-285`) : combiné à H-3, la table `tikis_places` peut accumuler des doublons quasi identiques.

### 🟢 Basse
- **B-1** — Rate-limit géographique en mémoire de processus, inefficace si l'app est scalée horizontalement (`server/routers.ts:157-170`).
- **B-2** — `concealPlace` (masquage avant sélection du livreur) réinitialise `precision` mais pas `featureType`, incohérence latente (`server/routers.ts:253-265`).

### Points forts confirmés (à préserver)
- GPS = seule source utilisée pour tout calcul de distance/itinéraire (`server/geography.ts:477-500`, `lib/geo-rules.ts:136-150`, `hooks/use-driver-pickup-distance.ts:77`) — aucune exception trouvée.
- Formatage centralisé massivement adopté (23 fichiers), avec tests dédiés aux scénarios A→J de la spec.
- Autorisation par session (plus de `phone` client) et token Mapbox jamais exposé côté client.

---

## 2. Workflow de livraison (états, candidatures, notifications, temps réel)

### 🔴 C-1. Aucune notification aux livreurs compatibles à la publication ou réactivation d'une livraison

`createTikisDelivery` (`server/db.ts:382-387`) et `reactivateTikisDeliveryFromSender` (`:1008-1018`) se limitent à un `INSERT`/`UPDATE` — aucun appel à `appendDeliveryEvent` ni à un broadcast vers les livreurs compatibles. La spec exige explicitement d'« informer les livreurs compatibles » à la publication. Actuellement, la seule découverte possible est le polling manuel de `deliveries.list` (5 s) — ce n'est pas une notification.

**Recommandation** : à la création/réactivation, résoudre les livreurs compatibles et leur écrire un événement + push, comme c'est déjà fait pour `candidate_applied`.

### 🔴 C-2. « Annuler le choix du livreur » n'existe pas — confondu avec « annuler la livraison », qui est bloqué dès qu'un livreur est sélectionné

La spec distingue explicitement (§8 du document livraisons) deux actions Sender à l'état « livreur sélectionné » : *Remplacer* et *Annuler le choix du livreur* (retour à « sans livreur »), en insistant : « ces deux actions doivent être considérées comme deux traitements totalement différents ». Le code implémente correctement le remplacement, mais :
```ts
// app/delivery/[id].tsx:164
const canCancel = role === "sender" && (delivery.status === "open" || delivery.status === "disabled");
```
Dès que le statut passe à `pending_confirmation` ou `active`, il n'existe **aucun** bouton, mutation, ni chemin backend pour revenir à « sans livreur » sans en choisir un autre. `cancelTikisDeliveryFromSender` refuse explicitement ce cas. Un Sender ayant sélectionné le mauvais candidat, sans autre candidat disponible pour un remplacement, n'a **aucun recours** avant l'expiration automatique à 24h.

**Recommandation** : ajouter une mutation dédiée `deliveries.unselectCandidate` (transition `pending_confirmation → open`, libération de la commission bloquée, candidat évincé remis à `withdrawn`/`applied`) et le bouton correspondant.

### 🔴 C-3. Remplacer un candidat « sélectionné » mais pas encore « confirmé » : double crédit + deux candidats actifs simultanés

**Corroboré indépendamment par l'audit Finance (voir §3.1 ci-dessous) — bug confirmé avec un haut niveau de confiance.** `selectTikisDeliveryCandidateWithWallet` (`server/db.ts:1064-1103`) traite le remplacement d'un candidat `"selected"` (jamais débité) exactement comme celui d'un candidat `"confirmed"` (réellement débité) : il crédite le montant de la commission comme s'il s'agissait d'une compensation, alors que ce montant n'a jamais quitté le solde bloqué — et la requête `UPDATE ... WHERE status = "confirmed"` ne fait passer l'ancien candidat à `"replaced"` que s'il était confirmé, le laissant bloqué à `"selected"` indéfiniment sinon. Deux candidats `"selected"` coexistent alors sur la même livraison — le cas que la spec interdit explicitement.

### 🔴 C-4. Candidatures, retraits et signalements jamais synchronisés en temps réel

`submitApplication` et `withdraw` (`server/routers.ts:606-611, 663-667`) et `createDeliveryReport` (`server/admin-db.ts:117-128`) n'émettent aucun broadcast Realtime. Même quand un broadcast de statut existe (sélection, remplacement...), l'invalidation client ne couvre jamais `deliveries.candidates` (`components/tikis/delivery-realtime-provider.tsx:16-28`), et l'écran détail n'a pas de `refetchInterval` sur les candidats. Un Sender gardant l'écran ouvert ne verra jamais apparaître une nouvelle candidature ni un retrait en temps réel — violation directe de l'exigence « toutes les modifications... doivent être synchronisées via Supabase Realtime sans rafraîchissement manuel ».

### 🟠 H-1. Les coordonnées ne sont visibles qu'à la confirmation du livreur, pas à la sélection — et le popup de sélection décrit un mécanisme financier inexact

*Lié structurellement à la même cause que le §3.3 de l'audit Finance (l'état `pending_confirmation` non prévu par la spec).* `deliveryToView` (`server/db.ts:350-352`) n'expose `senderPhone`/`driverPhone` qu'aux statuts `active`/`completed`, jamais à `pending_confirmation` — alors que la spec dit que la sélection rend la mise en relation effective immédiatement. Pire, le popup de sélection affiche : « la commission bloquée du livreur sera **définitivement prélevée** » (`app/delivery/[id].tsx:127`), ce qui est factuellement faux au moment où l'utilisateur le lit (le débit réel n'a lieu qu'à la confirmation du livreur) — et ce texte contredit même une autre partie de l'app (`financial-modal.tsx:104`, qui dit correctement « après confirmation du livreur »).

**Recommandation** : trancher explicitement si `pending_confirmation` est un état produit assumé (auquel cas documenter la dérogation à la spec et corriger tous les textes utilisateur en conséquence) ou l'éliminer (débit + visibilité dès la sélection, conformément à la lettre de la spec).

### 🟠 H-2 à H-4. Fragilités de l'infrastructure Realtime
- **H-2** : un livreur ouvre un canal Realtime privé pour *chaque* livraison ouverte compatible (pas seulement les siennes), la grande majorité étant de toute façon rejetée par la RLS — charge inutile, ouverture/fermeture en boucle toutes les 12 s (`delivery-realtime-provider.tsx:9-31`).
- **H-3** : deux fichiers de policies RLS Realtime concurrents coexistent (`supabase/realtime_policies.sql`, basé sur une revendication JWT `delivery_ids` jamais peuplée nulle part dans le code = policy morte ; `supabase/realtime_auth_phone_rls.sql`, cohérente avec le code réel). Risque de confusion opérationnelle/sécurité.
- **H-4** : le statut et la position live d'une livraison ouvrent chacun leur propre `RealtimeChannel` sur le même topic `delivery:<id>` (`lib/supabase-tracking.ts:90-113` vs `hooks/use-live-delivery-position.ts:19-23`) — deux souscriptions dupliquées pour la même livraison.

### 🟡 Moyenne
- **M-1** — Le prix affiché à un candidat sans contre-offre est reconstruit via `commissionBlocked * 10`, supposant un taux de commission fixe à 10 % alors qu'il est configurable par l'admin (`components/tikis/candidates-sheet.tsx:209`) — affichage erroné dès que le taux change.
- **M-2** — Pièces jointes de signalement annoncées par la spec mais non branchées : le formulaire (`app/report/[id].tsx`) est un stub, `reports.create` n'accepte pas de champ pièce jointe alors que la colonne existe déjà en base.
- **M-3** — Aucune notification événementielle vers l'Admin pour les signalements, seulement un compteur recalculé au chargement du dashboard.
- **M-4** — `isOpenDeliveryFresh` (`shared/delivery-freshness.ts:17-21`) renvoie littéralement l'inverse de ce que son nom indique (retourne le résultat de « est expirée ») — sans impact actuel car non utilisée nulle part (code mort), mais trahit une confusion et un risque si réutilisée.
- **M-5** — Un candidat non retenu disparaît de son propre `deliveries.list` dès qu'un autre livreur est choisi, alors que la spec veut qu'il reste sélectionnable pour un remplacement futur — il reste techniquement accessible en backend mais introuvable dans son propre parcours applicatif (`server/db.ts:459-467`).
- **M-6** — Aucune mutation n'exige de preuve que le popup de confirmation a bien été affiché avant l'action ; un appel API direct produit le même effet sans passer par le popup (limite architecturale généralisée, pas une vulnérabilité isolée puisque l'autorisation métier est vérifiée par ailleurs).

### 🟢 Basse
- **B-1** — Polling (2 s) et Realtime simultanés pour la même donnée de position live (`hooks/use-live-delivery-position.ts:10-23`).
- **B-2** — Textes contradictoires entre le popup principal et sa note de bas de modale sur le moment exact où la commission est acquise.

---

## 3. Wallet, commission et transactions financières

> Note d'infrastructure : le schéma utilise en réalité `drizzle-orm/mysql-core` + `mysql2` (`drizzle/schema.ts:1`, `server/db.ts:3`), pas Postgres — Supabase n'intervient que pour le Realtime/RLS. Les garanties de verrouillage (`for("update")`) évaluées ci-dessous sont donc celles de MySQL/InnoDB.

### 🔴 C-1. Remplacement d'un livreur « sélectionné » non confirmé : double crédit + statut figé + deux candidats actifs

**Il s'agit du même bug que le §2 C-3 ci-dessus, trouvé indépendamment par les deux audits — confiance maximale.** Détail chiffré côté finance : `selectTikisDeliveryCandidateWithWallet` (`server/db.ts:1064-1103`) applique l'opération `"compensation"` (`availableDelta: +X, heldDelta: 0`) au candidat remplacé quel que soit son statut réel. Or seul un candidat `"confirmed"` a réellement été débité — un candidat `"selected"` a seulement sa commission bloquée (`heldBalance`). Pour ce dernier :
1. Son solde disponible augmente de X sans que son solde bloqué ne diminue (fonds créés à partir de rien).
2. La clause `WHERE status = "confirmed"` ne matche pas son statut réel (`"selected"`) : sa candidature reste indéfiniment `"selected"`, avec `commissionBlocked` inchangé, en parallèle du nouveau candidat également `"selected"` — **deux candidats actifs simultanément sur la même livraison**.
3. Si la livraison expire ensuite sans confirmation, `expireOpenTikisDeliveries` retrouve cette candidature orpheline et exécute un **second** déblocage du même montant.

**Résultat net pour une commission de 1 000 FCFA : le livreur remplacé finit avec +2 000 FCFA de solde disponible** au lieu de simplement récupérer ses 1 000 FCFA. Reproductible de façon déterministe (il suffit de remplacer un candidat avant qu'il n'ait confirmé — un parcours utilisateur banal).

**Recommandation** : distinguer explicitement le cas `"selected"` (traiter comme un simple déblocage, pas une compensation) du cas `"confirmed"` (compensation réelle), et élargir la clause `UPDATE` pour couvrir les deux statuts.

### 🔴 C-2. Le prix total de la livraison — pas seulement la commission — est crédité comme argent réel au Wallet du livreur

`completeTikisDeliveryWithEvents` (`server/db.ts:1165-1201`) et la branche d'auto-complétion à 24h (`server/db.ts:469-501`) créditent `Math.round(delivery.offeredPrice ?? delivery.estimatedPrice)` — le prix intégral de la course — sur le Wallet Tikis du livreur, disponible et retirable. La spec est pourtant explicite : Tikis « vend uniquement la mise en relation », le paiement Sender→Livreur se fait « hors app », et « aucun mouvement financier supplémentaire n'est réalisé par Tikis » à la complétion. Le code fait de Tikis un encaisseur de la totalité du flux financier, ce qui n'est prévu nulle part et implique une exposition (liquidité, conformité) absente du modèle « commission uniquement ». C'est une divergence architecturale majeure, pas un simple bug de calcul.

**Recommandation** : supprimer l'opération `credit` du prix total ; si un « gain potentiel » doit être affiché au livreur, le calculer côté lecture depuis l'historique, jamais comme écriture de Wallet.

### 🔴 C-3. Opérations financières admin non atomiques et non idempotentes

`adminForceCancelDelivery` (`server/admin-db.ts:368-393`) exécute les crédits de Wallet des candidats via `adminAdjustWallet`, qui ouvre **sa propre transaction indépendante** de celle qui met à jour les candidatures et la livraison. Si un crédit échoue après qu'un précédent a déjà été commité, la transaction externe fait rollback (candidatures/livraison inchangées) mais **le crédit déjà validé reste acquis** — état partiel persistant que la spec interdit explicitement. De plus, `idempotencyKey: admin-adjust:${adminId}:${randomUUID()}` génère une clé différente à chaque appel : un double-clic sur « Annuler » ou « Récompenser » côté admin crée un second crédit réel sans aucun garde-fou (contrairement aux opérations côté livreur, qui sont bien protégées par des clés déterministes versionnées).

**Recommandation** : faire accepter à `adminAdjustWallet` une transaction (`tx`) optionnelle pour l'exécuter dans celle de l'appelant ; remplacer `randomUUID()` par une clé déterministe (ex. `${deliveryId}:admin-force-cancel:${candidateId}`).

### 🔴 C-4. Le trigger d'immuabilité du journal financier, documenté comme existant, n'a en réalité jamais été créé

`drizzle/manual/0020_admin_console.sql:56` fait référence à un fichier `0016_wallet_ledger_immutability.sql` censé protéger `tikis_wallet_ledger` par des triggers `BEFORE UPDATE`/`BEFORE DELETE`, « même logique que » celui bien présent pour `tikis_admin_audit_log`. Vérification faite (git log, contenu réel du fichier `0016` existant, absence dans `drizzle/manual/`) : **ce fichier n'a jamais existé**. La table portant l'exigence d'immuabilité la plus critique de toute la spec (« aucune opération financière ne doit être supprimée ou modifiée ») n'a donc **aucune protection SQL** — seule la discipline du code applicatif (vérifiée par grep, actuellement respectée) l'empêche.

**Recommandation** : créer la migration manquante avec les mêmes triggers que `tikis_admin_audit_log`, appliquée à `tikis_wallet_ledger`.

### 🔴 C-5. Le KPI « commissionRevenue » du dashboard admin mélange le revenu réel de Tikis avec les retraits des utilisateurs

`server/admin-db.ts:227-234, 269` agrège **tous** les mouvements `operation = "debit"` du ledger — or ce type couvre à la fois la commission réellement prélevée par Tikis et les retraits de Wallet des utilisateurs eux-mêmes (YengaPay, règlement admin). Le chiffre d'affaires affiché à l'équipe finance est gonflé et inexact dès qu'un retrait a lieu dans la période considérée.

**Recommandation** : introduire un type d'opération dédié (`commission_debit`) distinct du débit générique de retrait, ou filtrer strictement sur la `reason`.

### 🟠 H-1. La commission n'est réellement acquise qu'à la confirmation du livreur, pas à la sélection

Cause commune avec le §2 H-1 ci-dessus. Si le livreur sélectionné ne confirme jamais, la livraison expire à 24h et **la commission est intégralement rendue, sans pénalité** (`shared/delivery-expiration.ts`, `server/db.ts:504-523`) — alors que la spec affirme que la commission est acquise dès la sélection, puisque la mise en relation a eu lieu à cet instant. Un livreur sélectionné pourrait exécuter la course de façon informelle après contact hors app sans jamais confirmer, et Tikis ne percevrait alors rien.

### 🟠 H-2. Le remplacement reste possible même quand la livraison est déjà `"active"` (livreur déjà confirmé, potentiellement déjà en mission)

`server/db.ts:1064-1069` autorise `["open", "active", "pending_confirmation"]` comme statuts de départ pour un remplacement. Remplacer un livreur `"active"` déclenche un remboursement intégral d'une commission pourtant déjà réellement débitée et, selon la spec, définitivement acquise — et fait régresser le statut de la livraison de `"active"` vers `"pending_confirmation"`, un chemin non décrit par la spec.

**Recommandation** : restreindre le remplacement aux statuts `"open"` et `"pending_confirmation"`.

### 🟠 H-3. Le montant de commission « confirmé » par le popup côté client n'est jamais vérifié côté serveur

`submitApplication` (`server/routers.ts:606-610`) reçoit `confirmedCommission` mais `applyForTikisDelivery` (`server/db.ts:835-871`) ne le lit jamais — il recalcule sa propre commission et l'applique sans comparaison ni rejet en cas d'écart. Cela contredit l'affirmation de `wallet-audit.md` selon laquelle « le serveur refuse toute candidature sans montant confirmé » : en réalité le serveur accepte n'importe quelle valeur sans la vérifier. Si le taux change entre l'affichage du popup et l'envoi, le livreur peut voir bloquer un montant différent de celui qui lui a été montré, sans qu'aucune incohérence ne soit détectée.

### 🟡 Moyenne
- **M-1** — Code mort inatteignable dans `cancelTikisDeliveryFromSender` (`server/db.ts:1020-1044`) : un bloc traitant `pending_confirmation` ne peut jamais s'exécuter car la garde précédente ne l'autorise déjà plus — vestige d'une version antérieure, risque de réactivation accidentelle mal validée.
- **M-2** — Visibilité des coordonnées décalée à `active`/`completed` au lieu de la sélection (`server/db.ts:352`) — cohérent en interne avec H-1 mais écart structurel non tranché avec la spec.
- **M-3** — Le seul test de non-régression sur le crédit du gain (`tests/delivery-lifecycle-contract.test.ts`) vérifie la présence de sous-chaînes dans le code source brut, pas un comportement réel — fausse impression de couverture sur exactement la zone de C-2.
- **M-4** — `platformTopUp`/`platformSurplus` (`server/db.ts:1083-1093`) : mouvement de fonds sans contrepartie ni plafond en l'absence de wallet plateforme dans le schéma, amplifiant le risque de C-1 à grande échelle.
- **M-5** — `adminGetFinanceSettings` retombe silencieusement sur un taux de 10 % si la config est absente (`server/admin-db.ts:449`), contrairement à `getTikisCommissionRate()` qui lève une erreur explicite — incohérence de philosophie défensive.

### 🟢 Basse
- **B-1** — Clé d'idempotence non déterministe (`randomUUID()`) sur les demandes de dépôt/retrait informatives (`server/db.ts:658-672`) — impact limité (n'affecte pas les soldes) mais pollue le journal en cas de retry.

### Points forts confirmés
- `SELECT ... FOR UPDATE` correctement utilisé sur la livraison et/ou la candidature dans la plupart des opérations (`applyForTikisDelivery`, `withdrawTikisDeliveryCandidateWithWallet`, `selectTikisDeliveryCandidateWithWallet`) — protège bien contre les doubles-clics simples sur une même action.
- Le point B1 de l'audit du 2026-09-03 (verrouillage manquant sur `saveTikisDeliveryLiveLocation`) est corrigé.

---

## 4. Table de synthèse globale

| Domaine | # | Sévérité | Constat |
|---|---|---|---|
| Finance / Workflow | **F-C1 / W-C3** | 🔴 | Remplacement d'un candidat « sélectionné » non confirmé → double crédit + deux candidats actifs (confirmé par 2 audits indépendants) |
| Finance | F-C2 | 🔴 | Prix total (pas la commission) crédité au Wallet du livreur à la complétion |
| Finance | F-C3 | 🔴 | Opérations admin (annulation forcée, récompense parrainage) non atomiques et non idempotentes |
| Finance | F-C4 | 🔴 | Trigger d'immuabilité du ledger financier documenté mais jamais créé |
| Finance | F-C5 | 🔴 | KPI « commissionRevenue » pollué par les retraits utilisateurs |
| Lieux | L-C1 | 🔴 | Classification POI perdue à l'écriture (fallback communautaire) — casse l'exemple « Maison du Peuple » |
| Workflow | W-C1 | 🔴 | Aucune notification aux livreurs compatibles à la publication d'une livraison |
| Workflow | W-C2 | 🔴 | « Annuler le choix du livreur » absent |
| Workflow | W-C4 | 🔴 | Candidatures/retraits/signalements jamais synchronisés en Realtime |
| Finance / Workflow | F-H1 / W-H1 | 🟠 | Commission acquise et coordonnées visibles seulement à la confirmation, pas à la sélection (+ textes utilisateur inexacts) |
| Finance | F-H2 | 🟠 | Remplacement possible sur une livraison déjà `active` |
| Finance | F-H3 | 🟠 | `confirmedCommission` du popup jamais vérifié côté serveur |
| Lieux | L-H1 | 🟠 | Légende de mini-carte viole « Ville → Ville », hors formateur centralisé |
| Lieux | L-H2 | 🟠 | Code mort de sélection de lieu (2e système jamais utilisé) |
| Lieux | L-H3 | 🟠 | Cache géocodage inverse à 7 décimales, quasi inopérant |
| Workflow | W-H2 | 🟠 | 1 canal Realtime par livraison ouverte compatible, non filtré |
| Workflow | W-H3 | 🟠 | Deux policies RLS Realtime concurrentes, une morte |
| Workflow | W-H4 | 🟠 | Canaux Realtime dupliqués (statut + position) |
| Finance | F-M1..M5 | 🟡 | Code mort inatteignable, coordonnées décalées, test non comportemental, top-up sans contrepartie, défaut silencieux du taux |
| Workflow | W-M1..M6 | 🟡 | Prix candidat mal recalculé (taux en dur), pièces jointes signalement non branchées, pas de notif admin, fonction nommée à l'envers, candidat orphelin invisible, popups non tracés côté serveur |
| Lieux | L-M1..M3 | 🟡 | Pas de sanitization serveur, blocage pays sans décision documentée, pas de dédup par proximité |
| Divers | B1, B2... | 🟢 | Rate-limit en mémoire, incohérences mineures de texte, polling redondant |

---

## 5. Plan d'action priorisé

### Avant toute mise en production avec de l'argent réel
1. Corriger **F-C1/W-C3** (double crédit) — traiter différemment un candidat `selected` (jamais débité) d'un candidat `confirmed` (réellement débité) lors d'un remplacement, et garantir qu'un seul candidat reste actif par livraison.
2. Corriger **F-C2** — retirer le crédit du prix total à la complétion ; ne créditer que ce qui correspond réellement au modèle commission.
3. Trancher **F-H1/W-H1** — décider si `pending_confirmation` est un état produit assumé ou à éliminer, puis aligner code + textes utilisateur + spec sur une seule vérité (visibilité des coordonnées, acquisition de la commission).
4. Sécuriser **F-C3/F-C4** — rendre les opérations admin atomiques + idempotentes, créer le trigger d'immuabilité manquant sur `tikis_wallet_ledger`.
5. Corriger **F-C5** — séparer le débit de commission du débit de retrait dans le ledger pour fiabiliser le reporting.
6. Implémenter **W-C2** (annuler le choix du livreur) et **W-C1** (notifier les livreurs compatibles) — fonctionnalités métier explicitement requises et absentes.
7. Corriger **L-C1** — restaurer la classification des lieux sur le chemin d'écriture.

### Court terme (fiabilité et cohérence)
- Brancher le Realtime sur candidatures/retraits/signalements (**W-C4**) et nettoyer les canaux dupliqués/non filtrés (**W-H2 à H4**).
- Restreindre le remplacement aux statuts pertinents (**F-H2**), vérifier `confirmedCommission` côté serveur (**F-H3**).
- Corriger la légende de mini-carte (**L-H1**) et le cache géo (**L-H3**).

### Nettoyage (dette technique, faible risque immédiat)
- Supprimer le code mort identifié : `place-sheets.tsx`/`place-picker.*` (**L-H2**), bloc inatteignable dans `cancelTikisDeliveryFromSender` (**F-M1**), `isOpenDeliveryFresh` (**W-M4**).
- Remplacer le test de contrat purement textuel par un test d'intégration réel sur le cycle de vie financier (**F-M3**).
- Sanitization serveur des libellés de lieux (**L-M1**).

---

## Annexe — méthodologie et fiabilité

Chaque domaine (lieux, workflow, finance) a été audité par un agent indépendant, sans partage de contexte entre eux ni avec les audits antérieurs présents dans le dépôt (`AUDIT_RAPPORT_2026-09-03.md`, `audit_gestion_lieux_tikis_2026-08-27.md`, `wallet-audit.md`), afin d'éviter tout biais de confirmation. Le fait que le bug **F-C1/W-C3** ait été découvert indépendamment par deux agents travaillant sur des périmètres de code différents (l'un en partant de la logique wallet, l'autre en partant du workflow d'états) est un signal de fiabilité fort — ce n'est pas une hypothèse, c'est un défaut reproductible de façon déterministe. Tous les autres findings citent un fichier et une ligne précis et sont vérifiables directement dans le code.

Ce rapport n'inclut pas de nouvel audit de sécurité générale (CORS, rate-limiting HTTP global, OTP de simulation, etc.) — ces points restent documentés dans `AUDIT_RAPPORT_2026-09-03.md` et n'ont pas été ré-vérifiés ici ; leur statut actuel (corrigé ou non) devrait faire l'objet d'un passage dédié si ce n'est pas déjà fait.
