// Load environment variables with proper priority (system > .env)
import "./scripts/load-env.js";
import type { ExpoConfig } from "expo/config";

// Identifiant de l'application sur les stores (iOS et Android). Ne jamais le changer après publication :
// pour les stores, ce serait une autre application.
const bundleId = "com.app.tikissemobile";
// Liens profonds : `tikisse://…`. Le second scheme est celui du modèle de départ ; il reste déclaré pour
// qu'un lien émis par une version précédente de l'application ouvre toujours celle-ci.
const schemes = ["tikisse", "manusikissemobile"];

const env = {
  // App branding - update these values directly (do not use env vars)
  appName: "Tikisse",
  appSlug: "tikisse-mobile",
  scheme: schemes,
  iosBundleId: bundleId,
  androidPackage: bundleId,
  googleMapsAndroidKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY,
  googleMapsIosKey: process.env.GOOGLE_MAPS_IOS_API_KEY,
  easProjectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
};

const config: ExpoConfig = {
  name: env.appName,
  slug: env.appSlug,
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/tikisse-logo.png",
  scheme: env.scheme,
  userInterfaceStyle: "automatic",
  // Suit `version` automatiquement à chaque publication plutôt qu'une chaîne figée à mettre à
  // jour à la main : sans lui, EAS Update (le jour où il sera activé) ne saurait à quel binaire
  // natif associer quelle mise à jour OTA.
  runtimeVersion: { policy: "appVersion" },
  ios: {
    supportsTablet: true,
    bundleIdentifier: env.iosBundleId,
    // Numéro de build App Store : distinct de `version` (le numéro visible par l'utilisateur),
    // incrémenté à chaque soumission vers TestFlight/l'App Store, y compris entre deux versions
    // identiques. Un premier envoi côté EAS Build l'auto-incrémente ensuite lui-même.
    buildNumber: "1",
    config: {
      googleMapsApiKey: env.googleMapsIosKey,
    },
    "infoPlist": {
        "ITSAppUsesNonExemptEncryption": false
      }
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#401000",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    softwareKeyboardLayoutMode: "pan",
    predictiveBackGestureEnabled: false,
    package: env.androidPackage,
    // Entier strictement croissant exigé par le Play Store à chaque envoi, y compris entre deux
    // versions identiques (contrairement à `version`, jamais montré à l'utilisateur).
    versionCode: 1,
    config: {
      googleMaps: {
        apiKey: env.googleMapsAndroidKey,
      },
    },
    permissions: ["POST_NOTIFICATIONS", "ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION"],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: schemes.map((scheme) => ({ scheme, host: "*" })),
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/tikisse-logo.png",
  },
  extra: env.easProjectId ? { eas: { projectId: env.easProjectId } } : undefined,
  plugins: [
    [
      "expo-notifications",
      {
        color: "#A95000",
        defaultChannel: "tikisse-transactional",
      },
    ],
    "expo-router",
    "expo-font",
    "expo-web-browser",
    "expo-image",
    "expo-secure-store",
    "expo-status-bar",
    "expo-asset",
    [
      "expo-image-picker",
      {
        photosPermission: "Autoriser $(PRODUCT_NAME) à accéder à vos photos pour modifier votre photo de profil.",
        // L'app n'appelle jamais launchCameraAsync ni ne sélectionne de vidéo (mediaTypes
        // vaut ["images"] aux deux seuls appels, app/(tabs)/profile.tsx et
        // app/report/[id].tsx) : caméra et micro n'ont rien à demander.
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
    [
      "expo-location",
      {
        locationWhenInUsePermission: "Autoriser $(PRODUCT_NAME) à utiliser votre position pour prioriser les adresses proches de vous.",
        // « Toujours » n'est demandé qu'au livreur, et seulement au moment où une course devient
        // active (lib/background-location-task.ts) : jamais au lancement, jamais à l'expéditeur.
        locationAlwaysAndWhenInUsePermission: "Autoriser $(PRODUCT_NAME) à partager votre position avec l'expéditeur pendant une course active, même écran verrouillé.",
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    "expo-task-manager",
    [
      "expo-splash-screen",
      {
        image: "./assets/images/tikisse-logo.png",
        // Doit rester identique au splash animé (components/tikisse/animated-splash.tsx :
        // SPLASH_BACKGROUND, SPLASH_LOGO_SIZE) pour que le relais se fasse sans saut. Brun de l'icône
        // en mode clair comme en mode sombre.
        imageWidth: 128,
        resizeMode: "contain",
        backgroundColor: "#401000",
        dark: {
          backgroundColor: "#401000",
        },
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          buildArchs: ["armeabi-v7a", "arm64-v8a"],
          minSdkVersion: 24,
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
