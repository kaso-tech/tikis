import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const TIKISSE_SESSION_KEY = "tikisse.profile.session";
// Renommage Tikis → Tikisse : ancienne clé, relue en secours si l'appareil n'a pas encore de jeton sous
// le nouveau nom (mise à jour de l'app sans nouvelle connexion). Le serveur accepte encore les jetons émis
// avant le renommage (server/tikisse-session.ts) ; ce jeton reste donc valable le temps qu'une prochaine
// connexion l'écrive sous le nouveau nom.
const LEGACY_TIKIS_SESSION_KEY = "tikis.profile.session";

// Web n'a plus besoin de gérer ce jeton lui-même : le serveur pose déjà un cookie de session httpOnly
// (setTikisseProfileCookie, server/_core/cookies.ts) que le navigateur envoie automatiquement avec
// `credentials: "include"` (lib/trpc.ts). Le stocker aussi dans `sessionStorage` — lisible par n'importe
// quel script, y compris un script tiers injecté par XSS — puis le renvoyer en en-tête `x-tikisse-session`
// (que le serveur privilégiait sur le cookie) revenait à annuler la protection httpOnly : un vol de
// session par XSS suffisait à usurper l'identité de l'utilisateur depuis n'importe où, sans jamais
// toucher au cookie. Seul le natif (sans cookie jar partagé de la même façon) a encore besoin d'un jeton
// géré côté client, dans le stockage sécurisé du système d'exploitation (pas lisible par du JS injecté).

export async function getTikisseSessionToken() {
  if (Platform.OS === "web") return null;
  const current = await SecureStore.getItemAsync(TIKISSE_SESSION_KEY);
  if (current) return current;
  return SecureStore.getItemAsync(LEGACY_TIKIS_SESSION_KEY);
}

export async function setTikisseSessionToken(token: string) {
  if (!token || token.length > 4096) throw new Error("Jeton de session Tikisse invalide.");
  if (Platform.OS === "web") return;
  await SecureStore.setItemAsync(TIKISSE_SESSION_KEY, token);
}

export async function clearTikisseSessionToken() {
  if (Platform.OS === "web") return;
  await SecureStore.deleteItemAsync(TIKISSE_SESSION_KEY);
  await SecureStore.deleteItemAsync(LEGACY_TIKIS_SESSION_KEY).catch(() => {});
}
