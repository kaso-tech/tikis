import * as ReactNative from "react-native";

/** Adresse du serveur Tikisse, fixée au build (EXPO_PUBLIC_API_BASE_URL, ex. https://api.tikisse.app). */
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";

/**
 * Adresse du serveur pour les appels de l'application.
 *  - EXPO_PUBLIC_API_BASE_URL si elle est définie (toujours le cas pour une application publiée) ;
 *  - en développement web (Metro sur le port 8081), le serveur local sur le port 3000 ;
 *  - sinon une adresse relative : la version web publiée est servie par le serveur lui-même.
 */
export function getApiBaseUrl(): string {
  if (API_BASE_URL) return API_BASE_URL.replace(/\/$/, "");
  if (ReactNative.Platform.OS === "web" && typeof window !== "undefined" && window.location?.port === "8081") {
    return `${window.location.protocol}//${window.location.hostname}:3000`;
  }
  return "";
}
