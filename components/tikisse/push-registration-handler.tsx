import { useTikisseStore } from "@/lib/tikisse-store";
import { usePushRegistration } from "@/hooks/use-push-registration";
import { useEffect } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { trpc } from "@/lib/trpc";
import { setTikisseSessionToken } from "@/lib/tikisse-session";

/** Petit composant sans rendu qui déclenche le hook d'enregistrement push quand un profil Tikisse est connecté. */
export function PushRegistrationHandler() {
  const { profile } = useTikisseStore();
  usePushRegistration(profile?.phone ?? null);

  // Enregistre aussi la session courante (pour le multi-device), après l'avoir prolongée si son jeton a
  // plus d'une semaine : une session qui sert ne s'éteint jamais, aucun SMS à repayer pour se reconnecter.
  const register = trpc.sessions.registerCurrent.useMutation();
  const renew = trpc.sessions.renew.useMutation();
  useEffect(() => {
    if (!profile?.phone) return;
    void (async () => {
      try {
        const result = await renew.mutateAsync();
        if (result.renewed) await setTikisseSessionToken(result.sessionToken);
      } catch { /* l'ancien jeton reste valable : nouvel essai à la prochaine ouverture */ }
      await register.mutateAsync({
        platform: Platform.OS === "web" ? "web" : (Platform.OS as "ios" | "android"),
        appVersion: (Constants.expoConfig?.version as string | undefined) ?? undefined,
      }).catch(() => undefined);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.phone]);

  return null;
}
