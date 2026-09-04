import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const TIKIS_SESSION_KEY = "tikis.profile.session";

// Web n'a plus besoin de gérer ce jeton lui-même : le serveur pose déjà un cookie de session httpOnly
// (setTikisProfileCookie, server/_core/cookies.ts) que le navigateur envoie automatiquement avec
// `credentials: "include"` (lib/trpc.ts). Le stocker aussi dans `sessionStorage` — lisible par n'importe
// quel script, y compris un script tiers injecté par XSS — puis le renvoyer en en-tête `x-tikis-session`
// (que le serveur privilégiait sur le cookie) revenait à annuler la protection httpOnly : un vol de
// session par XSS suffisait à usurper l'identité de l'utilisateur depuis n'importe où, sans jamais
// toucher au cookie. Seul le natif (sans cookie jar partagé de la même façon) a encore besoin d'un jeton
// géré côté client, dans le stockage sécurisé du système d'exploitation (pas lisible par du JS injecté).

export async function getTikisSessionToken() {
  if (Platform.OS === "web") return null;
  return SecureStore.getItemAsync(TIKIS_SESSION_KEY);
}

export async function setTikisSessionToken(token: string) {
  if (!token || token.length > 4096) throw new Error("Jeton de session Tikis invalide.");
  if (Platform.OS === "web") return;
  await SecureStore.setItemAsync(TIKIS_SESSION_KEY, token);
}

export async function clearTikisSessionToken() {
  if (Platform.OS === "web") return;
  await SecureStore.deleteItemAsync(TIKIS_SESSION_KEY);
}
