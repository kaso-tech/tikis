import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const TIKIS_SESSION_KEY = "tikis.profile.session";

function webStorage() {
  if (typeof sessionStorage === "undefined") return null;
  return sessionStorage;
}

export async function getTikisSessionToken() {
  if (Platform.OS === "web") return webStorage()?.getItem(TIKIS_SESSION_KEY) ?? null;
  return SecureStore.getItemAsync(TIKIS_SESSION_KEY);
}

export async function setTikisSessionToken(token: string) {
  if (!token || token.length > 4096) throw new Error("Jeton de session Tikis invalide.");
  if (Platform.OS === "web") {
    webStorage()?.setItem(TIKIS_SESSION_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(TIKIS_SESSION_KEY, token);
}

export async function clearTikisSessionToken() {
  if (Platform.OS === "web") {
    webStorage()?.removeItem(TIKIS_SESSION_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(TIKIS_SESSION_KEY);
}
