# Logique métier — Gestion des lieux Tikis

## 1. Principe fondamental

Dans Tikis, un lieu est une entité géographique identifiable par ses coordonnées GPS.

Les coordonnées GPS constituent la source de vérité technique du lieu.

Les informations textuelles associées au lieu servent uniquement à :

- identifier le lieu ;
- le présenter à l'utilisateur ;
- faciliter sa compréhension ;
- construire des libellés adaptés au contexte.

Une information d'affichage ne doit jamais remplacer les coordonnées GPS pour les calculs géographiques.

---

## 2. Modèle métier d'un lieu

Chaque lieu Tikis possède deux catégories d'informations.

### 2.1. Données techniques

Elles servent aux traitements internes :

- latitude ;
- longitude ;
- Google Place ID, lorsqu'il existe ;
- adresse formatée provenant du fournisseur géographique.

Ces informations servent notamment à :

- calculer les distances ;
- calculer les itinéraires ;
- positionner les markers ;
- effectuer la navigation ;
- comparer deux positions ;
- retrouver un lieu auprès du fournisseur cartographique.

L'adresse formatée n'est pas considérée comme le libellé principal destiné à l'utilisateur.

### 2.2. Données descriptives

Elles servent à identifier et présenter naturellement le lieu.

Le système peut disposer de :

- nom du lieu ;
- rue ;
- quartier ;
- arrondissement / district ;
- ville ;
- province / région ;
- pays.

Ces informations peuvent provenir de différentes sources :

1. Google Places ;
2. Reverse Geocoding ;
3. données déjà enregistrées dans Tikis ;
4. informations saisies ou sélectionnées par l'utilisateur.

Le système doit privilégier les données les plus précises et les plus fiables disponibles.

---

## 3. Un lieu doit être réutilisable

Lorsqu'un même lieu est utilisé plusieurs fois dans Tikis, le système doit réutiliser ses informations existantes plutôt que recommencer inutilement les recherches géographiques.

**Exemple :** si Tikis connaît déjà « Maison du Peuple, Ouagadougou » et que l'utilisateur sélectionne à nouveau ce lieu, Tikis doit réutiliser les informations disponibles lorsque cela est possible.

L'objectif est d'éviter :

- les appels Google inutiles ;
- les reverse geocoding répétitifs ;
- les incohérences entre deux représentations du même lieu ;
- les temps d'attente inutiles.

---

## 4. Sélection d'un lieu

Lorsqu'un utilisateur sélectionne un lieu sur une carte, dans une recherche ou parmi ses favoris, Tikis doit considérer cette action comme une sélection de lieu géographique.

La sélection doit fournir au système toutes les informations disponibles sur le lieu :

- coordonnées GPS ;
- nom du lieu ;
- quartier ;
- ville ;
- adresse formatée ;
- identifiant du lieu lorsqu'il existe.

La sélection d'un marker ne doit déclencher aucune action métier secondaire. Elle doit uniquement modifier le lieu actuellement sélectionné.

---

## 5. Classification du lieu

Après sélection ou récupération d'un lieu, Tikis doit déterminer les informations géographiques disponibles.

Le système doit notamment déterminer :

- le nom du lieu ;
- le quartier ;
- la ville ;
- éventuellement le district ;
- éventuellement la rue ;
- si le lieu appartient ou non à la même ville que l'autre lieu de la livraison.

Cette classification permet ensuite de déterminer automatiquement le libellé approprié.

---

## 6. Principe de contextualisation

Un même lieu peut être affiché différemment selon le contexte. Par exemple, une adresse complète peut être inutile dans une liste de livraisons mais nécessaire dans la page de détail.

Tikis doit donc adapter le niveau d'information au contexte. Il existe quatre principaux contextes métier :

### 6.1. Liste de livraisons
**Objectif :** comprendre immédiatement le trajet. Le libellé doit être court.

### 6.2. Détail d'une livraison
**Objectif :** identifier précisément les lieux. Le libellé peut être plus détaillé.

### 6.3. Favoris
**Objectif :** reconnaître rapidement un lieu enregistré. Le libellé doit être naturel et mémorisable.

### 6.4. Navigation
**Objectif :** fournir suffisamment d'informations pour identifier correctement la destination. Le système peut utiliser les données techniques et descriptives disponibles.

---

## 7. Règle métier principale des listes de livraison

Pour une livraison, Tikis compare les villes du point de collecte et du point de destination.

### 7.1. Même ville

Lorsque les deux lieux appartiennent à la même ville, Tikis doit privilégier la compréhension locale.

Ordre de préférence :

1. nom du lieu public ;
2. quartier ;
3. rue ;
4. ville.

**Exemples :**

- « Maison du Peuple → Stade du 4 Août »
- Si aucun nom de lieu n'est disponible : « Karpala → Ouaga 2000 »
- Si aucun quartier n'est disponible : « Rue X → Rue Y »
- Si aucune information locale suffisamment précise n'est disponible : « Ouagadougou → Ouagadougou »

Le système doit toujours privilégier l'information la plus utile et la plus courte.

---

## 8. Villes différentes

Lorsque le point de collecte et le point de destination sont situés dans des villes différentes, Tikis doit simplifier fortement l'affichage.

Le format principal devient : **« Ville → Ville »**

**Exemples :**

- « Ouagadougou → Koudougou »
- « Bobo-Dioulasso → Ouagadougou »
- « Ouagadougou → Gonse »

Dans ce contexte, les quartiers et rues ne doivent pas être affichés dans la carte compacte de livraison, car ils apportent généralement moins de valeur que l'information sur les villes.

---

## 9. Gestion des lieux situés hors agglomération

Si un lieu ne possède pas de quartier identifiable, Tikis ne doit pas considérer cela comme une erreur. Le système doit descendre automatiquement dans la hiérarchie disponible.

**Exemple :** lieu avec latitude + longitude, ville = Koudougou, quartier = absent, place_name = absent → résultat : « Koudougou ».

Si la ville elle-même n'est pas disponible, le système doit utiliser le niveau administratif disponible.

---

## 10. Page de détail d'une livraison

La page de détail doit fournir davantage d'informations que la liste.

Priorité d'affichage :

1. nom du lieu ;
2. quartier ;
3. ville ;
4. district / province si nécessaire.

**Exemples :**

- « Résidence Kaboré / Ouaga 2000 / Ouagadougou »
- « Alimentation Bon Samaritain / Karpala / Ouagadougou »

L'objectif est que l'utilisateur puisse identifier précisément le lieu sans avoir à interpréter une adresse technique.

---

## 11. Gestion des favoris

Les favoris doivent privilégier la mémorisation humaine. Le système doit utiliser le nom le plus naturel disponible.

**Exemples :**

- « Maison du Peuple »
- « Ouaga 2000 »
- « Karpala »
- « Koudougou »

Le système ne doit pas afficher systématiquement l'adresse complète lorsqu'un nom simple permet déjà d'identifier le lieu.

---

## 12. Fallback universel

Lorsqu'un lieu ne possède pas toutes les informations nécessaires, Tikis doit construire automatiquement le meilleur libellé possible.

Hiérarchie :

- **Niveau 1 :** Nom du lieu + quartier + ville
- **Niveau 2 :** Nom du lieu + ville
- **Niveau 3 :** Quartier + ville
- **Niveau 4 :** District + ville
- **Niveau 5 :** Ville
- **Niveau 6 :** Adresse formatée

Le système doit choisir le premier niveau suffisamment complet disponible.

---

## 13. Nettoyage des informations

Avant tout affichage, les données doivent être nettoyées. Les valeurs suivantes doivent être ignorées :

- `null` ;
- `undefined` ;
- chaînes vides ;
- espaces inutiles ;
- informations dupliquées ;
- séparateurs sans contenu.

**Exemple incorrect :** « Maison du Peuple, undefined, Ouagadougou »
**Résultat attendu :** « Maison du Peuple, Ouagadougou »

Le système ne doit jamais exposer une valeur technique ou vide à l'utilisateur.

---

## 14. Unification du formatage

Toute décision concernant le nom affiché d'un lieu doit passer par une logique métier centralisée.

Les écrans ne doivent pas décider eux-mêmes :

- quelles informations afficher ;
- dans quel ordre ;
- quel fallback utiliser ;
- comment comparer deux lieux.

Cette responsabilité appartient au système de gestion des lieux.

Ainsi, si la règle métier change ultérieurement (ex. : « afficher désormais le secteur avant le quartier »), la modification doit pouvoir être effectuée à un seul endroit.

---

## 15. Google Places et Reverse Geocoding

Google Places et le Reverse Geocoding sont des sources d'enrichissement des lieux, et non la source de vérité de la position.

Lorsqu'un lieu est sélectionné :

1. Tikis récupère les coordonnées GPS ;
2. Tikis utilise les données disponibles du lieu ;
3. Tikis complète les informations manquantes si nécessaire ;
4. Tikis normalise les informations ;
5. Tikis conserve le résultat réutilisable ;
6. Tikis construit les libellés nécessaires selon le contexte.

Si les informations nécessaires sont déjà disponibles, aucun nouvel appel externe ne doit être effectué inutilement.

---

## 16. Cache des informations géographiques

Les informations géographiques doivent être réutilisées lorsqu'elles sont déjà connues.

Avant d'effectuer une nouvelle recherche, Tikis doit vérifier si les données nécessaires sont déjà disponibles.

Le système doit notamment éviter de répéter inutilement :

- une recherche Google Places ;
- un reverse geocoding ;
- une résolution d'adresse ;
- une récupération du même Place ID.

Le cache doit permettre d'améliorer :

- la rapidité ;
- la consommation des API ;
- la stabilité ;
- l'expérience utilisateur.

---

## 17. Distance et itinéraire

Les calculs géographiques doivent toujours utiliser **latitude + longitude**, et non les libellés textuels.

Par conséquent, « Karpala » ou « Maison du Peuple » ne servent jamais directement à déterminer une distance.

Les coordonnées GPS restent la référence pour :

- distance collecte → destination ;
- distance livreur → collecte ;
- estimation du trajet ;
- calcul du prix ;
- affichage de l'itinéraire ;
- navigation.

---

## 18. Cohérence entre les écrans

Le même lieu doit être représenté de manière cohérente dans toute l'application.

Par exemple, si Tikis identifie « Maison du Peuple, Ouagadougou », la liste, le détail, les favoris et la sélection de lieu doivent tous utiliser les mêmes données de base.

Seul le niveau de détail affiché peut changer selon le contexte.

---

## 19. Compatibilité avec les fonctionnalités existantes

La refonte du système des lieux ne doit pas modifier les règles métier existantes concernant :

- création d'une livraison ;
- modification d'une livraison ;
- calcul des distances ;
- calcul des prix ;
- navigation ;
- favoris ;
- notifications ;
- historique.

La refonte doit modifier principalement la manière dont les lieux sont structurés, enrichis, réutilisés et présentés.

---

## 20. Principe de non-régression

Avant toute modification, le fonctionnement existant doit être considéré comme la base de référence.

Le nouveau système doit :

- réutiliser les données existantes lorsque possible ;
- réutiliser les services existants lorsqu'ils sont fiables ;
- réutiliser les composants existants lorsqu'ils sont compatibles ;
- éviter de créer une seconde logique parallèle ;
- éviter de dupliquer les appels Google ;
- éviter de créer plusieurs modèles concurrents pour les lieux.

La nouvelle architecture doit remplacer progressivement les anciennes règles de gestion des lieux.

---

## 21. Cas métier à couvrir

Le système doit fonctionner correctement dans les situations suivantes :

- **Cas A — Deux lieux connus :** « Maison du Peuple → Stade du 4 Août »
- **Cas B — Même ville, pas de nom d'établissement :** « Karpala → Ouaga 2000 »
- **Cas C — Villes différentes :** « Ouagadougou → Koudougou »
- **Cas D — Quartier absent :** « Hôpital → Ouagadougou »
- **Cas E — Nom de lieu absent :** « Karpala → Pissy »
- **Cas F — Informations très limitées :** « Ouagadougou → Koudougou »
- **Cas G — Lieu hors agglomération :** utiliser le niveau administratif disponible.
- **Cas H — Adresse Google complète disponible mais données descriptives incomplètes :** utiliser l'adresse formatée comme dernier recours après extraction des informations pertinentes.
- **Cas I — Même lieu sélectionné plusieurs fois :** réutiliser les informations déjà connues.
- **Cas J — Marker sélectionné :** sélectionner uniquement le lieu, sans déclencher d'action métier supplémentaire.

---

## 22. Résultat métier attendu

Le système de gestion des lieux Tikis doit fonctionner selon le principe suivant :

> GPS → Identification du lieu → Enrichissement → Normalisation → Classification → Formatage contextuel → Affichage

- Les coordonnées GPS déterminent la position réelle.
- Les données géographiques permettent d'identifier le lieu.
- Les données descriptives permettent de comprendre le lieu.
- Le système choisit ensuite automatiquement la représentation la plus pertinente selon le contexte.

L'utilisateur ne doit jamais avoir à comprendre la structure technique des données géographiques.

---

## 23. Règle d'or

> **Tikis doit stocker et calculer avec des données géographiques précises, mais communiquer avec l'utilisateur avec des informations géographiques simples et naturelles.**

**Technique :** `12.3714, -1.5197` — Google Place ID — `formatted_address`
**Utilisateur :** « Maison du Peuple / Ouagadougou »

Le système doit toujours faire la distinction entre ces deux niveaux.
