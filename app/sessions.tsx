import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SessionsSection } from "@/components/tikis/sessions-section";
import { useThemeColors } from "@/lib/use-theme-colors";

export default function SessionsScreen() {
  const { colors: theme } = useThemeColors();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={["top", "bottom"]}>
      <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retour"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.back, { backgroundColor: theme.background }, pressed && styles.pressed]}
        >
          <MaterialIcons name="arrow-back" size={22} color={theme.foreground} />
        </Pressable>
        <View>
          <Text style={[styles.headerLabel, { color: theme.primary }]}>Sécurité</Text>
          <Text style={[styles.headerTitle, { color: theme.foreground }]}>Sessions actives</Text>
        </View>
      </View>
      <SessionsSection />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  headerLabel: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.7, textTransform: "uppercase" },
  headerTitle: { fontSize: 17, fontWeight: "700", marginTop: 2 },
  pressed: { opacity: 0.7 },
});
