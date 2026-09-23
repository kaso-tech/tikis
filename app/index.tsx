import { ActivityIndicator, StyleSheet, View } from "react-native";
import { AuthFlow } from "@/components/tikis/auth-flow";
import { useSessionRestore } from "@/hooks/use-session-restore";
import { useThemeColors } from "@/lib/use-theme-colors";

export default function IndexScreen() {
  const { colors: theme } = useThemeColors();
  const restore = useSessionRestore();

  // Tant que la session n'a pas été tranchée, ni l'un ni l'autre : afficher le parcours
  // d'authentification puis le remplacer une fraction de seconde plus tard ferait clignoter un
  // écran de connexion à chaque ouverture, exactement ce qu'on cherche à supprimer.
  if (restore !== "absent") {
    return (
      <View style={[styles.splash, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  return <AuthFlow />;
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: "center", justifyContent: "center" },
});
