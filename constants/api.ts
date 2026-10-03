import * as ReactNative from "react-native";
import { resolveApiBaseUrl } from "./api-base-url";

export { resolveApiBaseUrl, TIKISSE_PRODUCTION_API_URL } from "./api-base-url";

/** Adresse du serveur pour les appels de l'application. */
export function getApiBaseUrl(): string {
  const webLocation = typeof window === "undefined" ? undefined : window.location;
  return resolveApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL, ReactNative.Platform.OS, webLocation);
}
