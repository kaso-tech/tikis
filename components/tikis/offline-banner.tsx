import { useNetworkStatus } from "@/hooks/use-network-status";
import { type ThemedColors, useThemeColors } from "@/lib/use-theme-colors";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Platform, StyleSheet, Text, View } from "react-native";

export function OfflineBanner() {
  const status = useNetworkStatus();
  const { colors: theme } = useThemeColors();
  if (status === "online" || status === "unknown") return null;
  const styles = makeStyles(theme);
  return (
    <View
      accessibilityRole="alert"
      accessibilityLabel="Connexion réseau indisponible. Vos actions seront mises en file d’attente dès que la connexion revient."
      style={styles.banner}
    >
      <MaterialIcons name="wifi-off" size={16} color={theme.error} />
      <Text style={styles.text} numberOfLines={2}>
        Connexion réseau indisponible — vos actions seront synchronisées dès le retour de la connexion.
      </Text>
    </View>
  );
}

function makeStyles(theme: ThemedColors) {
  return StyleSheet.create({
    banner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 8,
      backgroundColor: theme.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
      ...(Platform.OS === "web" ? { position: "sticky" as const, top: 0, zIndex: 50 } : {}),
    },
    text: { flex: 1, fontSize: 12, color: theme.muted, lineHeight: 16 },
  });
}
