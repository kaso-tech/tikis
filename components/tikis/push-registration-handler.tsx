import { useTikisStore } from "@/lib/tikis-store";
import { usePushRegistration } from "@/hooks/use-push-registration";
import { useEffect } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { trpc } from "@/lib/trpc";

/** Petit composant sans rendu qui déclenche le hook d'enregistrement push quand un profil Tikis est connecté. */
export function PushRegistrationHandler() {
  const profile = useTikisStore((state) => state.profile);
  usePushRegistration(profile?.phone ?? null);

  // Enregistre aussi la session courante (pour le multi-device).
  const register = trpc.sessions.registerCurrent.useMutation();
  useEffect(() => {
    if (!profile?.phone) return;
    void register.mutateAsync({
      platform: Platform.OS === "web" ? "web" : (Platform.OS as "ios" | "android"),
      appVersion: (Constants.expoConfig?.version as string | undefined) ?? undefined,
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.phone]);

  return null;
}
