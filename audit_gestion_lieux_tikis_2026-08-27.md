# Audit ciblé — Système de gestion des lieux Tikis

**Date :** 27 août 2026  
**Périmètre :** recherche, sélection, enrichissement, stockage, favoris, formatage, calcul d’itinéraire et affichage des lieux.  
**Référentiel évalué :** `logique_metier_gestion_lieux_tikis.md` ajouté au projet.

## Synthèse exécutive

Le système actuel possède une **base saine** : les coordonnées GPS sont bien conservées dans le modèle de lieu, les distances et itinéraires sont calculés à partir de latitude/longitude, l’accès à Mapbox est maintenu côté serveur et les interfaces de sélection proposent recherche, carte, favoris, filtrage pays et biais GPS. Ces fondations sont cohérentes avec le principe directeur défini dans la nouvelle logique métier.

L’implémentation reste toutefois **partielle et hétérogène**. Le principal écart est l’absence d’un véritable service de gestion des lieux : l’enrichissement, le cache, la classification et les libellés contextuels sont répartis dans plusieurs modules. Les listes, le détail, l’historique et le suivi consomment encore un format générique, alors que le référentiel exige des représentations différentes selon le contexte. Enfin, les procédures géographiques et les favoris ne sont pas protégés par une autorisation liée à l’utilisateur connecté ; c’est le risque le plus important avant un lancement réel.

> **Conclusion :** Tikis est prêt pour une refonte incrémentale et non destructive. La priorité n’est pas de remplacer la carte ou l’API, mais de créer une couche métier unique `PlaceService` / `LocationFormatter`, de sécuriser les accès, puis de faire évoluer les écrans vers les formats de liste, détail, favori et navigation décrits dans le document métier.

## Méthode et sources analysées

L’audit est statique : il confronte les règles métier ajoutées au code exécuté dans le projet. Les constats n’affirment pas l’existence d’un incident de production ; ils identifient les écarts fonctionnels et les risques déductibles de l’implémentation actuelle.

| Source | Rôle dans l’audit |
|---|---|
| `logique_metier_gestion_lieux_tikis.md` | Référentiel de GPS source de vérité, enrichissement, cache, contextualisation et non-régression. |
| `shared/tikis-domain.ts` | Contrat `LocationLabel` et formatteurs actuellement utilisés. |
| `lib/geo-rules.ts` | Normalisation, libellés de trajet et calculs à partir des coordonnées. |
| `server/geography.ts` | Intégration Mapbox Search, retrieve, géocodage inverse et Directions. |
| `server/routers.ts` et `server/db.ts` | Validation, persistance canonique et favoris. |
| `components/tikis/place-picker.*`, `place-sheets.tsx`, `app/create-delivery.tsx` | Recherche, sélection et sauvegarde dans le parcours de création. |
| `delivery-card.tsx`, `app/delivery/[id].tsx`, `app/history.tsx`, `app/track/[id].tsx` | Représentation des lieux dans les contextes de consultation. |
| Tests géographiques et de libellés | Niveau actuel de couverture des règles. |

## Évaluation de conformité métier

| Domaine du référentiel | État | Constats |
|---|---|---|
| GPS comme source de vérité | **Conforme** | `LocationLabel` contient latitude/longitude ; la route Mapbox et le repli Haversine les utilisent, sans calcul fondé sur un texte. |
| Données descriptives enrichies | **Partiel** | Nom, rue, quartier/district, ville, région et pays existent, mais la qualité dépend de parseurs Mapbox fragiles et le niveau de précision n’est pas conservé. |
| Réutilisation/caching des lieux | **Partiel** | La table canonique déduplique par `googlePlaceId` ou `mapboxPlaceId`, mais elle n’est jamais consultée avant recherche, retrieve ou reverse geocoding. |
| Sélection sans effet métier secondaire | **Globalement conforme** | Un appui carte modifie le lieu sélectionné ; le recalcul d’itinéraire est déclenché ensuite par le formulaire, ce qui est acceptable mais doit rester explicite. |
| Classification après sélection | **Partiel** | Les champs sont extraits, mais aucun statut de précision, type de lieu ou niveau de confiance n’est calculé ni stocké. |
| Libellés par contexte | **Non conforme** | Le même `displayLocation` est utilisé pour liste, historique, détail et suivi ; la logique « même ville / villes différentes » ne pilote pas les listes. |
| Favoris naturels et mémorisables | **Partiel** | Le libellé favori est personnalisable, mais le défaut utilise toujours `place.name`, potentiellement technique ou moins naturel. |
| Fallback universel | **Partiel** | Des fallbacks existent, mais ils sont différents dans `locationTitle`, `displayLocation`, `compactRouteLabel` et `detailedPlaceLabel`. |
| Nettoyage des valeurs | **Partiel** | Le texte est assaini côté client et dans le service, mais les données de lieu sauvegardées via l’API ne sont pas toutes normalisées côté serveur. |
| Non-régression / modèle unique | **Non conforme** | Deux modules portent des règles de présentation et plusieurs écrans choisissent directement leur formatage. |

## Points solides à préserver

Le modèle actuel respecte déjà l’axe central du document : `LocationLabel` conserve les coordonnées nécessaires, et `computeRoute` construit l’itinéraire avec les deux paires longitude/latitude. En cas d’indisponibilité du service d’itinéraire, `provisionalRoute` applique également une distance géodésique au lieu de s’appuyer sur un nom d’adresse. Cette partie doit être conservée lors de la refonte.

La recherche est correctement placée derrière le serveur : le jeton Mapbox backend est lu uniquement côté serveur et ajouté à la requête sortante. Le client reçoit un résultat filtré, jamais le secret. Les suggestions obtiennent un identifiant Mapbox et sont résolues avant validation finale ; le marqueur de carte et la fiche de création affichent déjà une ligne principale et une ligne de contexte. Le filtre par pays et le biais GPS récemment ajoutés constituent également de bons leviers de pertinence.

| Élément solide | Valeur métier | À préserver pendant la refonte |
|---|---|---|
| Coordonnées persistées | Itinéraires, distance, estimation, marqueurs et navigation restent exacts. | Conserver latitude/longitude comme champs obligatoires et jamais dérivés du libellé. |
| Enrichissement Mapbox backend | Recherche, retrieve, reverse geocoding et Directions sont séparés du client. | Conserver le jeton secret exclusivement côté serveur. |
| Déduplication par identifiant fournisseur | Évite une partie des doublons de lieux canoniques. | Étendre la stratégie plutôt que la remplacer. |
| Assainissement de texte | Limite les caractères inattendus dans les requêtes et libellés. | Déplacer aussi cette garantie dans le contrat serveur. |
| États de chargement et messages | La sélection et les requêtes ne sont pas silencieuses. | Harmoniser ces états autour d’un même cycle de résolution. |

## Constats détaillés et recommandations

### Risques critiques — à corriger avant la production

| ID | Constat | Preuve dans le système actuel | Risque | Recommandation prioritaire |
|---|---|---|---|---|
| **L-01** | Les opérations de lieux et de favoris ne sont pas liées à une identité authentifiée côté serveur. | Toutes les procédures `geography` sont des `publicProcedure`; les favoris reçoivent un `phone` fourni par le client. | Un tiers connaissant un numéro peut tenter de lire, renommer ou supprimer des favoris associés à ce numéro ; le backend peut aussi être utilisé comme proxy Mapbox public. | Passer à une procédure authentifiée, dériver le profil depuis la session/JWT, retirer `phone` des entrées client et appliquer un contrôle de propriété pour chaque mutation. |
| **L-02** | Aucun contrôle de débit ni mécanisme anti-abus ne protège Search, retrieve, reverse ou Directions. | Les routes publiques appellent directement Mapbox. | Coût API, saturation, déni de service et consommation abusive du quota Mapbox. | Ajouter rate limiting par identité/IP, limites de concurrence, délai exponentiel sur 429, cache applicatif et télémétrie de coût. |
| **L-03** | Les valeurs descriptives soumises à `savePlace` sont seulement limitées en longueur. | `placeSchema` valide les tailles, mais ne réapplique pas `sanitizePlaceText` ni une normalisation de structure. | Données incohérentes, libellés instables et réapparition de caractères/espaces non désirés si le client est contourné. | Créer un schéma serveur `normalizeAndValidatePlace` : texte normalisé, coordonnées strictes, identifiants conformes et cohérence pays/profil. |

### Écarts métier majeurs — à corriger en première itération

| ID | Constat | Conséquence visible | Recommandation |
|---|---|---|---|
| **L-04** | Les libellés ne sont pas réellement contextuels. | Une carte de liste peut afficher rue + quartier + ville même lorsque les deux lieux sont dans des villes différentes, au lieu de « Ville → Ville ». | Centraliser quatre formatteurs : `formatListRoute`, `formatDeliveryDetailPlace`, `formatFavorite`, `formatNavigationTarget`. |
| **L-05** | La règle « même ville / villes différentes » est codée seulement dans `compactRouteLabel`, tandis que listes et détail utilisent `displayLocation`. | L’information affichée diffère selon l’écran et ne respecte pas les exemples A–C du référentiel. | Utiliser `formatListRoute(pickup, dropoff)` dans `DeliveryCard`, l’historique et les cartes compactes. |
| **L-06** | `detailedPlaceLabel` existe mais n’est pas consommé par le détail de livraison. | Le détail reprend une chaîne générique plutôt que « nom / quartier / ville / région si nécessaire ». | Afficher un titre et un sous-titre par point ; réserver l’adresse formatée au dernier recours ou à une action « voir l’adresse complète ». |
| **L-07** | La classification est implicite et non persistée. | Impossible de savoir si la donnée est une adresse, un POI, une rue, un quartier, une ville ou un point GPS approximatif. | Ajouter `provider`, `providerPlaceId`, `source`, `featureType`, `precision`, `resolutionStatus`, `resolvedAt` et éventuellement `accuracyMeters`. |
| **L-08** | Les suggestions sont converties avec latitude/longitude `0,0` avant retrieve. | Une suggestion non résolue peut techniquement devenir un lieu géographique valide dans les composants qui ne forcent pas la résolution. | Distinguer `PlaceSuggestion` de `ResolvedPlace`. Les coordonnées doivent être obligatoires uniquement dans `ResolvedPlace`; supprimer le placeholder `0,0`. |
| **L-09** | L’adresse est réutilisable seulement après sauvegarde/favori/publication. | Rechercher ou sélectionner plusieurs fois le même lieu dans une session continue à provoquer des appels externes. | Introduire `findCanonicalPlace` avant retrieve/reverse et un cache mémoire court pour recherche/résolution, avec TTL et clé normalisée. |
| **L-10** | Le cache ne couvre pas le géocodage inverse par coordonnées. | Plusieurs pressions proches ou répétées sur carte déclenchent plusieurs appels. | Créer une clé spatiale arrondie (par exemple 5 décimales) et réutiliser un résultat inverse lorsque précision et ancienneté sont compatibles. |

### Fiabilité, qualité de données et performance

| ID | Observation | Impact | Amélioration recommandée |
|---|---|---|---|
| **L-11** | `saveTikisPlace` déduplique par identifiant fournisseur, mais pas par coordonnées ou adresse normalisée. | Un point posé manuellement peut produire plusieurs lieux identiques sans identifiant. | Prévoir une clé de proximité/empreinte géographique et une règle de fusion prudente, sans fusionner automatiquement deux POI voisins. |
| **L-12** | Les lignes géographiques n’ont pas de cycle d’actualisation ni de provenance par champ. | Une correction fournisseur ou un enrichissement plus précis ne peut pas être arbitré ni rafraîchi proprement. | Stocker `source`, `resolvedAt`, `lastValidatedAt`, version du fournisseur et règle de rafraîchissement. |
| **L-13** | Les appels de route sont déclenchés à chaque changement de pickup/dropoff. | Plusieurs résolutions rapides peuvent provoquer des requêtes concurrentes ; un ancien résultat pourrait arriver après le plus récent. | Ajouter un identifiant de requête/annulation et mettre en cache les itinéraires sur une clé origine-destination arrondie. |
| **L-14** | Le repli géodésique est utile mais son coefficient fixe ne décrit pas le niveau d’incertitude. | L’estimation provisoire peut être peu adaptée à des trajets hors réseau routier ou interurbains. | Renvoyer un niveau de confiance, afficher une fourchette et interdire certains engagements tarifaires tant que le trajet n’est pas routier. |
| **L-15** | Le `countryCode` filtre Search mais n’est pas réappliqué à retrieve, reverse geocoding ou forward geocoding. | Un point carte à proximité d’une frontière, un favori ancien ou une résolution directe peut sortir du pays du profil. | Contrôler le pays résolu après chaque enrichissement et définir une règle métier claire : avertissement, blocage ou confirmation explicite. |
| **L-16** | Les données descriptives de fournisseur sont réduites à quelques clés de contexte. | Selon les réponses Mapbox, numéro, sous-adresse, localité, région ou texte localisé peut être perdu. | Formaliser un adaptateur Mapbox testé avec plusieurs formes de réponse et conserver l’objet normalisé complet nécessaire à l’affichage. |

### Expérience utilisateur et cohérence des écrans

| ID | Observation | Impact utilisateur | Amélioration recommandée |
|---|---|---|---|
| **L-17** | Le web affiche une carte informative mais ne permet pas la sélection manuelle d’un point, contrairement au natif. | L’expérience de choix précis diffère selon la plateforme. | Afficher clairement la limitation, ou proposer un sélecteur cartographique web quand Mapbox GL sera disponible. |
| **L-18** | La sélection est fermée immédiatement après un résultat résolu. | L’utilisateur ne confirme pas visuellement l’adresse complète, le pays et la position avant retour au formulaire. | Ajouter une étape légère de confirmation : marqueur, titre/sous-titre, adresse complète pliable, bouton « Confirmer ce lieu ». |
| **L-19** | Les favoris utilisent un nom saisi ou `place.name`, sans proposition de libellé naturel contextualisée. | Un favori peut être enregistré sous une adresse technique ou une ville seule. | Proposer un défaut `formatFavorite(location)` éditable, par exemple POI > quartier > rue > ville. |
| **L-20** | L’adresse formatée est parfois utilisée comme sous-titre sans distinction entre information utilisateur et donnée fournisseur. | Des chaînes longues, répétitives ou peu localisées peuvent encombrer les écrans. | Conserver l’adresse complète pour la fiche et la navigation, mais afficher des variantes courtes centralisées dans les listes. |
| **L-21** | Les marqueurs sélectionnés n’affichent que la valeur courante ; la position GPS de l’utilisateur n’est pas séparée visuellement du point sélectionné. | Risque de confusion entre « je suis ici » et « je choisis ce lieu ». | Ajouter un marqueur de position utilisateur et un marqueur de sélection distincts, avec légende et accessibilité. |

## Problème structurel central : plusieurs logiques concurrentes

La nouvelle logique métier demande explicitement une décision de libellé à un seul endroit. Or, l’application répartit actuellement cette responsabilité entre `shared/tikis-domain.ts` (`locationTitle`, `locationSubtitle`, `displayLocation`), `lib/geo-rules.ts` (`shortPart`, `compactRouteLabel`, `detailedPlaceLabel`) et les composants qui les combinent. Cette répartition entraîne trois risques : une évolution des règles peut oublier un écran, un même lieu peut être affiché différemment sans raison métier, et les tests ne peuvent pas prouver l’ensemble des cas A–J du référentiel.

La cible recommandée est un module métier sans dépendance UI :

```ts
type ResolvedPlace = {
  id?: number;
  provider: "mapbox" | "manual" | "legacy";
  providerPlaceId?: string;
  coordinates: { latitude: number; longitude: number };
  address: { name?: string; street?: string; neighborhood?: string; district?: string; city?: string; region?: string; country?: string; formatted?: string };
  classification: { featureType: "address" | "poi" | "street" | "neighborhood" | "locality" | "place" | "point"; precision: "exact" | "street" | "area" | "city" | "unknown" };
  provenance: { source: "search" | "retrieve" | "reverse" | "favorite" | "manual"; resolvedAt: string };
};

formatListRoute(pickup, dropoff)       // même ville : information locale ; villes différentes : ville → ville
formatDetailPlace(place)               // nom, quartier, ville, région si utile
formatFavorite(place)                  // mémo humain, court et éditable
formatNavigationTarget(place)          // données les plus complètes utiles à la navigation
```

Cette cible conserve les données existantes en les adaptant progressivement ; elle n’exige pas de modifier les calculs de distance ou de prix.

## Feuille de route recommandée

| Priorité | Lot | Résultat attendu | Critères d’acceptation |
|---|---|---|---|
| **P0** | Autorisation et anti-abus | Les favoris et la géographie sont associés au compte connecté, avec quotas. | Impossible d’accéder aux favoris d’un autre profil en modifiant une requête ; quotas et réponses 429 sont testés. |
| **P0** | Contrat de lieu résolu | Séparation stricte entre suggestion et lieu avec coordonnées réelles. | Aucun objet utilisable pour route/favori ne contient `0,0` par défaut ; toutes les coordonnées sont validées. |
| **P1** | Service de normalisation et de cache | Un seul pipeline GPS → enrichissement → normalisation → cache. | Un même `mapboxPlaceId` évite retrieve ; un reverse proche utilise le cache ; mesures de cache hit disponibles. |
| **P1** | Formatage contextuel | Les listes, détails, favoris et suivi utilisent des sorties métier dédiées. | Cas A–J du document automatisés ; villes différentes affichent « Ville → Ville ». |
| **P1** | Confirmation de sélection | L’utilisateur confirme un point et son libellé avant le retour au formulaire. | La fiche affiche titre, contexte, adresse technique pliable, pays et coordonnées de façon non technique. |
| **P2** | Qualité et observabilité | Suivi des erreurs fournisseurs, latence, no-result, coûts et précision. | Tableau de bord interne : taux de cache, latence p95, erreurs par endpoint et recherches sans résultat. |
| **P2** | Expérience web/native convergente | Même capacité de choix et même représentation des lieux. | La parité de comportement est validée, avec dégradation contrôlée si la carte native/web diffère. |

## Plan de tests à instituer

Le jeu de tests actuel couvre quelques suggestions, la résolution, le reverse geocoding, l’assainissement et deux cas de libellés. Il ne couvre pas encore les scénarios métier complets. Les cas suivants doivent devenir des tests déterministes du module de formatage, puis des tests d’intégration du service de lieux.

| Cas | Attendu |
|---|---|
| A — Deux POI, même ville | `Maison du Peuple → Stade du 4 Août` en liste. |
| B — Deux quartiers, même ville | `Karpala → Ouaga 2000` en liste. |
| C — Villes différentes | `Ouagadougou → Koudougou`, sans rue ni quartier. |
| D — Quartier absent | Le POI puis la ville sont conservés sans séparateur vide. |
| E — Nom absent | Les quartiers sont utilisés avant la ville. |
| F/G — Informations limitées/hors agglomération | Ville, puis région/district, puis adresse formatée en dernier recours. |
| H — Adresse fournisseur complète | Extraction des éléments utiles ; adresse complète seulement en dernier recours. |
| I — Même lieu répété | Cache primaire touché, aucun retrieve/reverse inutile. |
| J — Marker sélectionné | Met à jour uniquement le brouillon de lieu ; aucune publication, favori ou mutation secondaire. |
| Autorisation | Un utilisateur A ne peut lire, renommer ni supprimer les favoris de B. |
| Résilience | Réponse 429, timeout, absence de GPS, fournisseur incomplet et hors-pays donnent un état clair sans corrompre le lieu courant. |

## Décisions d’architecture à valider avec le produit

Les règles suivantes nécessitent une décision fonctionnelle explicite avant implémentation afin d’éviter des comportements implicites : la politique pour une destination dans un autre pays ; le niveau de précision minimal pour pouvoir publier une livraison ; la conservation ou non d’un nom utilisateur personnalisé sur un lieu canonique ; et la durée de vie maximale acceptée d’un cache de géocodage inverse.

Le passage futur à Mapbox GL doit rester indépendant de cette refonte. Le moteur de carte change la présentation et l’interaction, mais ne doit ni modifier le contrat `ResolvedPlace`, ni déplacer le token Mapbox vers le client, ni créer une seconde logique de formatage.

## Verdict final

La nouvelle logique métier est pertinente, précise et compatible avec les fondations Tikis. Elle met en évidence que le produit actuel a déjà résolu l’acquisition de coordonnées et une partie de l’enrichissement, mais pas encore la **gouvernance complète du lieu**. Les actions les plus rentables sont, dans l’ordre : protéger les procédures par une identité serveur, créer un pipeline de lieu résolu et mis en cache, centraliser les formats contextuels, puis étendre les tests avec les cas A–J. Cette trajectoire donnera des adresses plus fiables, moins d’appels Mapbox, des listes plus lisibles et un comportement cohérent de la création à la navigation.

## Références internes

| Référence | Élément |
|---|---|
| [1] | `logique_metier_gestion_lieux_tikis.md`, sections 1–23. |
| [2] | `shared/tikis-domain.ts`, lignes 56–69 et 145–156. |
| [3] | `lib/geo-rules.ts`, lignes 6–71. |
| [4] | `server/geography.ts`, lignes 66–181. |
| [5] | `server/routers.ts`, lignes 56–119. |
| [6] | `server/db.ts`, lignes 94–152. |
| [7] | `app/create-delivery.tsx`, lignes 23–204. |
| [8] | `components/tikis/place-picker.native.tsx` et `place-picker.web.tsx`. |
| [9] | `components/tikis/delivery-card.tsx`, lignes 27–36 ; `app/delivery/[id].tsx`, lignes 110–114. |
