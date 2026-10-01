# Tikis — Plan de conception mobile

## Intention produit

Tikis est une application mobile de mise en relation sécurisée entre **expéditeurs** et **livreurs**. L’expérience privilégie la compréhension immédiate du statut d’une livraison, la transparence de la commission de mise en relation, et des actions financières toujours explicitées et confirmées. L’application est conçue en portrait 9:16, avec des actions primaires placées dans le bas de l’écran pour une utilisation à une main.

## Principes d’interface

L’interface s’inspire des standards iOS contemporains : hiérarchie typographique nette, surfaces blanches ou très claires, gestes et transitions discrets, grandes zones tactiles, retours d’état visibles et navigation par onglets. Les informations opérationnelles sont synthétisées dans des cartes, tandis que les actions sensibles ouvrent une feuille de confirmation structurée plutôt qu’une alerte ambiguë.

## Couleurs de marque

| Élément | Couleur | Usage |
|---|---:|---|
| Marine Tikis | `#0B1F3A` | En-têtes, textes prioritaires, confiance et sécurité |
| Bleu signal | `#1E6BFF` | Actions principales, liens et éléments actifs |
| Menthe opérationnelle | `#18A572` | Attribution, succès, crédit et livraison terminée |
| Ambre | `#F59E0B` | Course active, attention et commission bloquée |
| Corail | `#E45858` | Erreur, action destructive et course désactivée |
| Nuage | `#F6F8FC` | Fond général et séparation des groupes |

Les statuts visibles par l’expéditeur utilisent les conventions métier définies : désactivée en rouge, active en orange, attribuée en vert, en transit en bleu et terminée en gris.

## Écrans

| Écran | Contenu principal | Actions importantes |
|---|---|---|
| Présentation et consentement | Proposition de valeur, sélecteur Français/English, conditions d’utilisation et politique de confidentialité | Accepter et continuer |
| Téléphone international | Pays pré-détecté, sélecteur de pays, indicatif fixe, longueur et espaces de saisie adaptés | Envoyer le code à six chiffres |
| Vérification OTP | Numéro masqué, six champs ou saisie groupée, délai de renvoi et aide | Vérifier le code, modifier le numéro, renvoyer le code |
| Choix de compte | Comparatif expéditeur/livreur et explication de l’irréversibilité du rôle | Choisir le rôle et continuer |
| Engins du livreur | Sélection multi-engins : vélo, moto, tricycle et voiture | Continuer vers l’identité |
| Identité | Nom complet assaini et contrôle de format standard | Créer le compte |
| Accueil expéditeur | Résumé d’activité, courses actives, statut, raccourci de création | Créer une livraison, ouvrir le détail, filtrer |
| Créer une livraison | Adresses, type, détails, engins, estimation intelligente et frais suggérés | Enregistrer, publier, modifier les choix |
| Détail expéditeur | Chronologie, détails, tarification, candidatures et validation par codes | Choisir/remplacer un livreur, suivre, signaler, noter |
| Liste des candidatures | Profils de livreurs, notes, engins, prix proposé et impact financier | Voir un profil, choisir un livreur |
| Accueil livreur | Disponibilités compatibles, solde wallet, gains et candidatures en cours | Ouvrir une course, consulter le wallet |
| Détail livreur | Informations utiles anonymisées avant sélection, tarification, détails et conditions | Se proposer, renoncer avant sélection, signaler |
| Wallet | Solde disponible, commission bloquée, derniers mouvements | Consulter le journal détaillé |
| Notifications | Évènements de courses, candidatures, attribution et signalements | Marquer comme lu, accéder à la course |
| Profil | Identité, rôle définitivement inscrit, engins, performance et préférences | Consulter les préférences et se déconnecter |
| Confirmation financière | Résumé, montant, conséquences fonctionnelles et caractère irréversible | Confirmer ou annuler |

## Parcours prioritaires

Le parcours d’accès commence par une présentation de Tikis avec choix de langue et consentement explicite. L’écran de téléphone détecte le pays d’après le fuseau de l’appareil et présélectionne le format correspondant. L’utilisateur peut modifier le pays ; l’indicatif, la longueur requise et les espaces de saisie sont alors mis à jour. Après une validation locale de format, Tikis génère un code OTP de simulation composé de **six chiffres exactement**. L’écran de vérification masque le numéro, active la validation dès la saisie complète, limite les tentatives et propose un renvoi temporisé.

Après validation de l’OTP, le numéro est recherché dans le répertoire de démonstration. Un numéro associé à un compte est connecté immédiatement selon son rôle inscrit. Sinon, le nouvel utilisateur choisit un rôle irréversible. L’expéditeur saisit son nom complet puis accède à son espace. Le livreur choisit d’abord un ou plusieurs engins — vélo, moto, tricycle ou voiture — puis saisit son nom complet. Tous les champs sont assainis ; le nom est limité à soixante-dix caractères et exige au minimum un prénom et un nom valides.

L’expéditeur crée d’abord une livraison, obtient une estimation contextualisée par l’engin choisi et la publie sans débit immédiat. Il consulte ensuite les candidatures, voit le prix et la commission de mise en relation concernée, puis sélectionne un livreur via une confirmation détaillée. Cette sélection rend les coordonnées visibles et acte définitivement une seule commission Tikis pour la livraison.

Le livreur explore les courses compatibles avec ses engins, ouvre une course dont l’expéditeur reste anonymisé et se propose après avoir confirmé le blocage temporaire de la commission. Tant qu’il n’est pas sélectionné, il peut renoncer et le blocage est libéré. Une fois sélectionné, il peut contacter l’expéditeur mais ne peut plus retirer sa candidature.

Le remplacement s’effectue directement depuis la liste des candidatures : le nouvel intervenant est sélectionné, sa commission est prélevée, puis la compensation de l’ancien intervenant est appliquée afin que Tikis ne conserve jamais plus d’une commission par livraison. La chronologie et le journal financier conservent une trace de chaque étape.

## Architecture fonctionnelle initiale

La première version fournie met en scène ces règles dans une expérience locale cohérente, avec des données de démonstration structurées et des confirmations financières. Les opérations monétaires réelles, l’authentification multi-utilisateur, la persistance distante, le temps réel et les notifications push seront reliés à des services côté serveur lors de l’intégration de production ; le client ne devra jamais modifier un solde directement.

## Modèle de domaine de démonstration

Le modèle partagé distingue les livraisons, les candidatures, le wallet exclusif au livreur, le journal financier immuable et les notifications. Une politique de commission réunit le taux et la devise ; tout montant affiché en commission est recalculé à partir du prix de la livraison et de cette politique, sans montant de commission figé dans l’interface.

| Entité | Responsabilité | Invariant principal |
|---|---|---|
| Livraison | Porte le statut, les lieux, la tarification et le livreur actif | Un seul livreur peut être actif à la fois |
| Candidature | Représente l’intérêt et le prix éventuel d’un livreur | Le retrait est permis uniquement avant sélection |
| Wallet livreur | Suit le solde total et les commissions temporairement bloquées | Le disponible ne peut jamais être négatif |
| Journal financier | Conserve les blocages, déblocages, débits et compensations | Une entrée ne peut pas être supprimée |
| Politique de commission | Définit le taux administrable appliqué au prix | La commission est calculée dynamiquement |
