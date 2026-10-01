# Audit textes UI — Tikis vs standards apps pro

**Date** : 11 septembre 2026
**Périmètre** : titres, sous-titres, empty states, helpers, messages d'erreur, CTA, placeholders, tooltips, dialogs
**Référence pro** : Stripe, Linear, Uber Driver, Glovo, Vinted, Airbnb

## Verdict global

**Note actuelle : 8,5/10** — la **grande majorité** des textes est déjà au niveau professionnel : pédagogiques, empathiques, culturellement adaptés (exemples locaux, accents cohérents). Très peu de nettoyage à faire.

## Ce qui est déjà pro ✅

### Titres de page (10/10)
- "Comment pouvons-nous aider ?" (Help)
- "Sessions actives" / "Vérification d'identité" (Profile)
- "Mes avis" / "Parrainage" / "Signaler" / "Évaluer la course"
- "Qu'envoyez-vous ?" / "D'où à où ?" / "Quel engin ?" / "Fixez le prix de la course" (Create Delivery — questions naturelles)

### Sous-titres pédagogiques (10/10)
- "Choisissez votre type de compte. Ce choix sera définitif après la création de votre compte."
- "Nous l'utiliserons pour sécuriser votre compte et vous connecter à Tikis."
- "Réponses aux questions les plus fréquentes sur Tikis."
- "Sélectionnez un ou plusieurs engins. Nous vous proposerons uniquement les courses compatibles."
- "Votre signalement est traité de manière confidentielle par l'équipe Tikis."
- "Les coordonnées précises sont protégées jusqu'à la confirmation de la mission." (privacy)

### Empty states (10/10)
- "En attente de candidatures" (avec sous-texte explicatif)
- "Aucun avis pour le moment" + "Les avis envoyés apparaîtront ici après vos évaluations."
- "Vos livraisons non publiées sont sauvegardées ici automatiquement depuis la page de création."
- "Aucune opportunité disponible" (livreur) / "Aucune livraison disponible" (expéditeur)
- "Aucun gain sur cette période" — adapté au contexte

### Messages d'erreur (10/10)
- "Connexion réseau indisponible. Vos actions seront mises en file d'attente dès que la connexion revient." — explique + rassure
- "Code invalide. Vérifiez les chiffres reçus par SMS ou e-mail." — pédagogique
- "Impossible d'enregistrer votre profil de façon sécurisée. Vérifiez votre connexion puis réessayez." — proactif
- "Décrivez votre demande en 10 caractères minimum (caractères autorisés)." — constructif
- "Le géocodage inverse est momentanément indisponible." — poli
- "Aucun moyen de paiement réel n'est débité dans ce mode." (simulation disclaimer)

### Helper texts (10/10)
- "Les espaces sont ajoutés automatiquement selon le format de votre pays."
- "Tous les champs sont assainis avant envoi. Les pièces jointes ne sont pas encore prises en charge."
- "Un nom unique est accepté. Seuls les lettres, espaces, apostrophes et traits d'union sont autorisés."
- "{comment.length}/500 · Votre avis doit rester respectueux et utile."

### Placeholders concrets (10/10)
- "Ex. 12" / "Ex : 2 000" (formats adaptés)
- "Ex. Maison ou Bureau" / "Ex. Mariam ou Mariam Ouédraogo" (culturellement local)
- "Rechercher un favori" / "Décrivez votre sujet en quelques mots" (instructions claires)

### CTA / Boutons (9/10)
- "Créer mon compte" / "Recevoir mon code" / "Vérifier le code"
- "Confirmer ce lieu" / "Confirmer la course" / "Confirmer la suppression"
- "Créer une livraison" / "Publier mon avis"
- "Modifier la livraison" / "Marquer comme terminée"
- **Aucun "OK" / "Oui" / "Non"** générique — tous contextuels

### Loading labels (10/10)
- "Candidature..." / "Carte..." / "Copie..." / "Enregistrement..."
- "Envoi en cours..." / "Préparation..." / "Validation..." / "Vérification..."
- Courts, en cours ("..."), lisibles

### Dialogs de confirmation (10/10)
- "« {label} » sera retiré de vos favoris. Cette action est irréversible." — cite l'élément + explique
- "Utilisez un libellé clair, par exemple « Maison » ou « Bureau centre »." — donne un exemple

### Success messages (10/10)
- "Signalement envoyé" + "Merci. Votre signalement concernant « X » a été transmis à l'administration Tikis et sera conservé dans la chronologie." — remercie + explique la suite
- "Message prêt à envoyer" + "Votre application de messagerie a été ouverte avec le message pré-rempli. Si elle ne s'est pas lancée, écrivez-nous directement à {email}." — proactif

### Tabs de navigation (10/10)
- "Accueil" / "Suivi" / "Gains" / "Wallet" / "Adresses" / "Profil" — courts, clairs, culturels

### Accessibility labels (10/10)
- "Appeler le livreur" / "Centrer la carte" / "Ajouter aux favoris" / "Effacer la recherche"
- "Connexion réseau indisponible. Vos actions seront mises en file d'attente dès que la connexion revient." (toast a11y)

### Disclaimer Stack technique (10/10 — exception)
- Dans `error-boundary.tsx`, "Stack technique" est affiché mais **uniquement en `__DEV__`** — ne leak pas en production

## Les 6 nettoyages à faire ⚠️

### 1. Incohérence "Retour" / "Revenir à l'accueil"
- 3 variantes : "Retour à la livraison" / "Retour à l'accueil" (×2) / "Revenir à l'accueil"
- **Fix** : standardiser sur "Revenir à l'accueil" (action) ou "Retour à ..." (chemin)
- **Recommandation** : "Revenir à l'accueil" (pour la nav) + "Retour à la livraison" (pour le contexte)

### 2. Bouton "Renoncer" (trop administratif)
- Style "notaire" — inhabituel dans une app moderne
- **Fix** : remplacer par "Annuler la suppression" ou "Abandonner la suppression"

### 3. Boutons debug "Échouer" / "Simuler réussite" dans `app/(tabs)/wallet.tsx`
- Visibles en production dans le dialog de request payment
- **Fix** : wrapper dans `__DEV__` ou déplacer dans une page dev dédiée

### 4. "Mode simulation : utilisez le code 730512" dans `auth-flow.tsx`
- Disclaimer de simulation visible à l'utilisateur final
- **Fix** : masquer le bloc `simulationNotice` en production via `__DEV__` ou via une prop `isDevelopment`

### 5. Hardcodé `#9A6201` sur `tabBarActiveTintColor`
- Dans `app/(tabs)/_layout.tsx`, `tabBarActiveTintColor: "#9A6201"` — devrait être `theme.primary`

### 6. Hardcoded `tabBarStyle.borderTopColor: theme.border` — déjà OK
- Mais à vérifier : `tabBarStyle` n'utilise pas `theme.surface` pour la backgroundColor en light/dark — vérifié, oui c'est bon

## Les éléments à garder (et pourquoi)

- **"Stack technique" en __DEV__** : essentiel pour debug, ne leak pas
- **"Simuler réussite" / "Échouer"** : pratique pour tester la prod locale sans vrai PSP, à garder **en __DEV__**
- **"Mode simulation : 730512"** : idem, à garder **en __DEV__** mais masquer en prod

## Bilan final

| Métrique | Évaluation |
|----------|------------|
| Titres de page | ✅ 10/10 — clairs, directs |
| Sous-titres | ✅ 10/10 — pédagogiques, contexte clair |
| Empty states | ✅ 10/10 — complets avec explications |
| Messages d'erreur | ✅ 10/10 — empathiques, proactifs |
| Helper texts | ✅ 10/10 — utiles, complets |
| Placeholders | ✅ 10/10 — concrets, culturellement adaptés |
| CTA | ✅ 9/10 — contextuels (sauf "Renoncer") |
| Loading labels | ✅ 10/10 — courts, en cours |
| Dialogs de confirmation | ✅ 10/10 — explique + confirme |
| Success messages | ✅ 10/10 — remercie + explique la suite |
| Tabs | ✅ 10/10 — courts, clairs |
| Accessibility | ✅ 10/10 — précis, utiles |
| Cohérence des variantes | ⚠️ 7/10 — "Retour" / "Revenir" incohérent |

**Note globale : 8,5/10** — niveau professionnel élevé. Nettoyages mineurs possibles (~30 minutes de travail).

## Plan de nettoyage (estimation 30 min)

1. `app/(tabs)/wallet.tsx` : wrapper "Échouer" / "Simuler réussite" dans `__DEV__`
2. `components/tikis/auth-flow.tsx` : wrapper `simulationNotice` dans `__DEV__`
3. `app/(tabs)/wallet.tsx` + autres : remplacer "Renoncer" par "Annuler la suppression"
4. `app/(tabs)/_layout.tsx` : `tabBarActiveTintColor: theme.primary`
5. Standardiser "Retour" / "Revenir à l'accueil" sur 2 variantes max

## Inspiration recommandée

- **Stripe** : "Couldn't process your payment. We saved your changes — try again in a moment." (toujours rassure + propose une action)
- **Linear** : "This view has no items yet. Press C to create your first one." (empty state avec raccourci clavier)
- **Uber Driver** : "We couldn't reach the rider. Try calling them directly." (action concrète en cas d'erreur)
- **Glovo** : "Estimation: 12-18 min" (plages réalistes, pas de promesse impossible)
