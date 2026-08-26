# Architecture cible : Mapbox GL et Supabase Realtime

## Décision

Tikis migre vers **Mapbox Search** pour les suggestions et la résolution d’adresse, et **Mapbox Directions** avec le profil `driving-traffic` pour les itinéraires routiers. Les appels Mapbox restent côté backend et utilisent exclusivement `MAPBOX_SECRET_ACCESS_TOKEN`. Le jeton public est réservé à Mapbox GL dans le futur build de développement Expo.

Pendant les tests avec Expo Go, la carte native actuelle reste disponible. **Mapbox GL** sera activé après la création d’un build de développement, car son module natif ne peut pas être chargé par Expo Go.

## Contrat de lieu

Une suggestion Mapbox est d’abord retournée avec un `mapboxId` et un jeton de session. À sa sélection, le backend appelle `retrieve` afin d’obtenir les coordonnées et l’adresse complète. Les coordonnées validées restent la source de vérité des estimations et des favoris. La table `tikis_places` conserve `mapboxPlaceId` pour dédupliquer les lieux, sans supprimer les identifiants Google historiques.

## Suivi GPS

Le canal privé `delivery:<deliveryId>` transmet des messages `position` validés contenant `latitude`, `longitude`, `heading` et `recordedAt`. La simulation locale reste active comme repli tant que les règles Supabase et l’authentification de production ne sont pas finalisées.

> Les messages GPS fréquents utilisent **Supabase Broadcast**. L’historique doit être persisté à cadence réduite, par exemple toutes les 20 à 30 secondes, dans une table de positions distincte.

## Sécurité

Les canaux doivent rester privés. Avant l’activation multi-utilisateur, le backend devra émettre un JWT Supabase contenant les droits de la course et les politiques RLS devront limiter `realtime.messages` à l’expéditeur et au livreur attribué. Un modèle de politique est préparé dans `supabase/realtime_policies.sql`.
