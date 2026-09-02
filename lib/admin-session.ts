import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const ADMIN_SESSION_KEY = "tikis.admin.session";

function webStorage() {
  if (typeof sessionStorage === "undefined") return null;
  return sessionStorage;
}

export async function getAdminSessionToken(): Promise<string | null> {
  if (Platform.OS === "web") return webStorage()?.getItem(ADMIN_SESSION_KEY) ?? null;
  try {
    return await SecureStore.getItemAsync(ADMIN_SESSION_KEY);
  } catch {
    return null;
  }
}

export async function setAdminSessionToken(token: string) {
  if (!token || token.length > 4096) throw new Error("Jeton de session administrateur invalide.");
  if (Platform.OS === "web") {
    webStorage()?.setItem(ADMIN_SESSION_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(ADMIN_SESSION_KEY, token);
}

export async function clearAdminSessionToken() {
  if (Platform.OS === "web") {
    webStorage()?.removeItem(ADMIN_SESSION_KEY);
    return;
  }
  try {
    await SecureStore.deleteItemAsync(ADMIN_SESSION_KEY);
  } catch {
    // ignore
  }
}
