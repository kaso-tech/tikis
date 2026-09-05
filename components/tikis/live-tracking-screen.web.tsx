import { ScreenContainer } from "@/components/screen-container";
import { useThemeColors } from "@/lib/use-theme-colors";
import { StyleSheet, Text, View } from "react-native";

export default function LiveTrackingWebScreen() {
  const { colors } = useThemeColors();

  return (
    <ScreenContainer>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Suivi en direct</Text>
        <Text style={[styles.message, { color: colors.muted }]}>La carte de suivi est disponible dans l’application mobile.</Text>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  title: { fontSize: 22, fontWeight: "700", textAlign: "center" },
  message: { marginTop: 10, fontSize: 15, lineHeight: 22, textAlign: "center" },
});
