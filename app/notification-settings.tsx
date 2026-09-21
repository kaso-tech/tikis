import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { TikisButton } from "@/components/tikis/ui";
import { usePushEnrollment } from "@/hooks/use-push-registration";
import { getPushPermissionStatus, type PushPermissionOutcome } from "@/lib/push-notifications";
import { useTikisStore } from "@/lib/tikis-store";
import { useThemeColors } from "@/lib/use-theme-colors";

export default function NotificationSettingsScreen() {
  const { colors: theme } = useThemeColors();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { role } = useTikisStore();
  const enablePush = usePushEnrollment();
  const [status, setStatus] = useState<"granted" | "denied" | "undetermined" | "unsupported">("undetermined");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setStatus(await getPushPermissionStatus());
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const enable = useCallback(async () => {
    setProcessing(true);
    setMessage("");
    setError("");
    try {
      const outcome: PushPermissionOutcome = await enablePush();
      if (outcome === "granted") {
        setStatus("granted");
        setMessage("Les notifications push sont activées sur cet appareil.");
      } else if (outcome === "denied") {
        setStatus("denied");
        setError("Les notifications sont bloquées. Autorisez Tikis dans les réglages du téléphone.");
      } else if (outcome === "unsupported") {
        setStatus("unsupported");
        setError("Les notifications push distantes nécessitent une version de développement Tikis. L’écran de notifications reste disponible dans l’application.");
      } else {
        setError("Cet appareil n’a pas pu être enregistré. Vérifiez l’identifiant EAS et votre connexion, puis réessayez.");
      }
    } finally {
      setProcessing(false);
    }
  }, [enablePush]);

  const openSystemSettings = () => {
    if (Platform.OS !== "web") void Linking.openSettings();
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="Retour">
          <MaterialIcons name="arrow-back" size={21} color={theme.foreground} />
        </Pressable>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={styles.back} />
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><MaterialIcons name="notifications-active" size={28} color={theme.primary} /></View>
          <Text style={styles.title}>Restez informé</Text>
          <Text style={styles.subtitle}>Recevez les informations importantes de Tikis, même lorsque l’application est fermée.</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: status === "granted" ? theme.success : status === "denied" ? theme.error : theme.muted }]} />
            <View style={styles.statusCopy}>
              <Text style={styles.cardTitle}>{loading ? "Vérification en cours" : status === "granted" ? "Notifications activées" : status === "denied" ? "Notifications bloquées" : status === "unsupported" ? "Version non compatible" : "Notifications non activées"}</Text>
              <Text style={styles.cardText}>{loading ? "Nous vérifions l’autorisation de cet appareil." : status === "granted" ? "Les événements de vos livraisons peuvent vous être signalés instantanément." : "Activez-les pour ne pas manquer une candidature, une confirmation ou une mise à jour importante."}</Text>
            </View>
            {loading ? <ActivityIndicator color={theme.primary} /> : null}
          </View>
          {status === "granted" ? null : (
            <TikisButton label="Activer les notifications" icon="notifications-active" onPress={() => void enable()} loading={processing} disabled={loading || processing} style={styles.button} />
          )}
          {status === "denied" ? <TikisButton label="Ouvrir les réglages du téléphone" icon="settings" variant="secondary" onPress={openSystemSettings} style={styles.button} /> : null}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}><MaterialIcons name="security" size={19} color={theme.primary} /><Text style={styles.cardTitle}>Vos données restent protégées</Text></View>
          <Text style={styles.cardText}>Tikis enregistre uniquement l’identifiant technique de vos appareils autorisés. Il est supprimé automatiquement lorsqu’Apple, Google ou Expo le déclare invalide.</Text>
        </View>

        {role === "driver" ? (
          <Pressable onPress={() => router.push("/driver-alerts" as never)} style={({ pressed }) => [styles.linkCard, pressed && styles.pressed]} accessibilityRole="button">
            <View style={styles.cardHeader}><MaterialIcons name="tune" size={19} color={theme.primary} /><Text style={styles.cardTitle}>Alertes de nouvelles courses</Text></View>
            <Text style={styles.cardText}>Configurez séparément les alertes de courses et votre périmètre de recherche.</Text>
            <MaterialIcons name="chevron-right" size={20} color={theme.muted} style={styles.chevron} />
          </Pressable>
        ) : null}

        {error ? <View style={styles.feedbackError}><MaterialIcons name="error-outline" size={17} color={theme.error} /><Text style={styles.feedbackText}>{error}</Text></View> : null}
        {message ? <View style={styles.feedbackInfo}><MaterialIcons name="check-circle" size={17} color={theme.success} /><Text style={styles.feedbackText}>{message}</Text></View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(theme: ReturnType<typeof useThemeColors>["colors"]) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.background },
    header: { height: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14 },
    back: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
    headerTitle: { flex: 1, textAlign: "center", color: theme.foreground, fontSize: 15, fontWeight: "700" },
    content: { padding: 16, paddingBottom: 34, gap: 12 },
    hero: { alignItems: "center", paddingVertical: 20, paddingHorizontal: 22 },
    heroIcon: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: theme.primary + "18", marginBottom: 12 },
    title: { color: theme.foreground, fontSize: 20, fontWeight: "700", textAlign: "center" },
    subtitle: { color: theme.muted, fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 6 },
    card: { backgroundColor: theme.surface, borderRadius: 12, padding: 15, gap: 12 },
    statusRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
    statusDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
    statusCopy: { flex: 1, gap: 4 },
    cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
    cardTitle: { color: theme.foreground, fontSize: 14, fontWeight: "700" },
    cardText: { color: theme.muted, fontSize: 12.5, lineHeight: 18 },
    button: { marginTop: 2 },
    linkCard: { backgroundColor: theme.surface, borderRadius: 12, padding: 15, gap: 8, position: "relative" },
    chevron: { position: "absolute", right: 14, top: 18 },
    feedbackError: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, backgroundColor: theme.error + "12", borderRadius: 10 },
    feedbackInfo: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, backgroundColor: theme.success + "12", borderRadius: 10 },
    feedbackText: { flex: 1, color: theme.foreground, fontSize: 12, lineHeight: 17 },
    pressed: { opacity: 0.72 },
  });
}
