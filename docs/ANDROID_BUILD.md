# Construire l'application Android

La construction tourne chez Expo (**EAS Build**). Elle se lance depuis GitHub, sans rien installer sur un ordinateur.
EAS crée et garde la clé de signature de l'application dès la première construction.

| Profil | Fichier produit | Usage |
|---|---|---|
| `preview` | APK | à installer directement sur un téléphone (tests, distribution hors Play Store) |
| `production` | AAB | à envoyer sur le Play Store |

Le numéro de version interne (`versionCode`) est géré par EAS et augmente tout seul à chaque construction.
Le numéro visible par l'utilisateur, lui, est `version` dans `app.config.ts`.

## 1. Préparation (une seule fois)

### Compte et projet Expo
1. Créez un compte sur [expo.dev](https://expo.dev). Créez ensuite un projet nommé **tikisse-mobile** : c'est le `slug` de `app.config.ts`, et le nom doit être exactement celui-là.
2. Notez l'**ID du projet** (Project ID), affiché sur la page du projet. Il n'est pas secret : il faut l'inscrire dans `EAS_PROJECT_ID` (`app.config.ts`).
3. Si le projet appartient à une organisation Expo, et pas à votre compte personnel, ajoutez dans GitHub une variable `EXPO_OWNER`. Sa valeur est le nom de l'organisation : Settings → Secrets and variables → Actions → *Variables*.

### Jeton d'accès Expo → GitHub
4. Sur expo.dev, ouvrez Account settings → Access tokens → *Create token*.
5. Dans GitHub, ouvrez Settings → Secrets and variables → Actions → *New repository secret*. Créez le secret `EXPO_TOKEN` avec ce jeton comme valeur.

### Variables de l'application (sur expo.dev)
6. Sur expo.dev, ouvrez le projet → **Environment variables**. Ajoutez les variables ci-dessous pour les environnements **preview** et **production**.

| Nom | Type | Valeur |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Plain text | même valeur que sur Render |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Plain text | même valeur que sur Render |
| `GOOGLE_MAPS_ANDROID_API_KEY` | Sensitive | clé Google Maps (étape 7) |
| `GOOGLE_SERVICES_JSON` | **File** | fichier `google-services.json` de Firebase (étape 8) |

L'adresse du serveur (`https://api.tikisse.com`) et l'activation de la connexion par SMS sont déjà fixées dans `eas.json`.

### Google Maps (cartes de l'application)
7. Dans la console Google Cloud, activez **Maps SDK for Android**. Créez ensuite une clé d'API limitée aux applications Android, avec le nom de package `com.app.tikissemobile`. Pour l'empreinte SHA-1, prenez celle de la clé de signature EAS : expo.dev → projet → Credentials → Android, une fois la première construction faite. Sans cette clé, les cartes restent grises.

### Notifications push (Firebase)
8. Dans la console Firebase, créez un projet. Ajoutez-y une application Android avec le package `com.app.tikissemobile`, puis téléchargez **google-services.json**. Déposez ce fichier dans la variable `GOOGLE_SERVICES_JSON` (étape 6).
9. Dans Firebase, ouvrez Paramètres du projet → Comptes de service et cliquez sur *Générer une nouvelle clé privée*. Envoyez ensuite ce fichier sur expo.dev : projet → Credentials → Android → **FCM V1 service account key**.
   Sans les étapes 8 et 9, l'application fonctionne, mais ne reçoit pas de notifications push.

## 2. Lancer une construction

GitHub → **Actions** → *Construction Android (EAS)* → **Run workflow**. Choisissez le profil (`preview` pour un APK), puis validez.
Le journal affiche un lien vers expo.dev. La construction prend environ 10 à 20 minutes. Le fichier se télécharge ensuite depuis expo.dev. Pour un APK `preview`, un QR code permet aussi de l'installer directement sur un téléphone.

## À savoir

- **Ancien APK (construit chez Manus)** : il est signé avec une autre clé. Il faut le désinstaller avant d'installer le nouveau.
- **Mise à jour de l'application** : pour publier une nouvelle version, changez `version` dans `app.config.ts`, par exemple 1.0.1. Le numéro interne s'incrémente tout seul.
- **Une modification du serveur** (Render) ne demande pas de reconstruire l'application. Il faut reconstruire seulement quand le code de l'application change (écrans, logos, textes…).
