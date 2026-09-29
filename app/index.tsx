import { ActivityIndicator, Image, StyleSheet, View } from "react-native";
import { AuthFlow } from "@/components/tikisse/auth-flow";
import { useEffect } from "react";
import { useSessionRestore } from "@/hooks/use-session-restore";
import { markAppReady } from "@/lib/app-ready";
import { useThemeColors } from "@/lib/use-theme-colors";

export default function IndexScreen() {
  const { colors: theme } = useThemeColors();
  const restore = useSessionRestore();

  // Session tranchée : l'authentification s'affiche, ou la navigation vers l'application est lancée.
  // Le splash animé peut s'effacer.
  useEffect(() => {
    if (restore !== "checking") markAppReady();
  }, [restore]);

  // Tant que la session n'a pas été tranchée, ni l'un ni l'autre : afficher le parcours
  // d'authentification puis le remplacer une fraction de seconde plus tard ferait clignoter un
  // écran de connexion à chaque ouverture, exactement ce qu'on cherche à supprimer.
  if (restore !== "absent") {
    return (
      <View style={[styles.splash, { backgroundColor: theme.background }]}>
        <Image accessibilityLabel="Logo Tikisse" source={require("../assets/images/icon.png")} style={styles.logo} />
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  return <AuthFlow />;
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: "center", justifyContent: "center" },
  logo: { width: 112, height: 112, marginBottom: 18 },
});
