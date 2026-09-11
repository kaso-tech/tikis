import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TikisButton } from "@/components/tikis/ui";
import { useDriverLocation } from "@/hooks/use-driver-location";
import { usePushEnrollment } from "@/hooks/use-push-registration";
import { haptic } from "@/lib/haptics";
import { useTikisStore } from "@/lib/tikis-store";
import { type ThemedColors, useThemeColors } from "@/lib/use-theme-colors";
import { trpc } from "@/lib/trpc";
import { describePerimeter, PERIMETER_RADIUS_OPTIONS_KM } from "@/shared/driver-perimeter";

type RadiusChoice = number | null;

function formatBaseAge(updatedAt: string | null): string {
  if (!updatedAt) return "Position non enregistrée";
  const elapsedMinutes = Math.max(0, Math.round((Date.now() - new Date(updatedAt).getTime()) / 60_000));
  if (elapsedMinutes < 1) return "Position enregistrée à l’instant";
  if (elapsedMinutes < 60) return `Position enregistrée il y a ${elapsedMinutes} min`;
  const hours = Math.round(elapsedMinutes / 60);
  if (hours < 24) return `Position enregistrée il y a ${hours} h`;
  return `Position enregistrée il y a ${Math.round(hours / 24)} j`;
}

export default function DriverAlertsScreen() {
  const { colors: theme } = useThemeColors();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { profile, role } = useTikisStore();
  const utilities = trpc.useUtils();
  const enablePush = usePushEnrollment();
  const driverLocation = useDriverLocation({ enabled: false });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [locating, setLocating] = useState(false);

  const preferencesQuery = trpc.driverPerimeter.get.useQuery(undefined, { enabled: role === "driver" && Boolean(profile?.phone) });
  const updateMutation = trpc.driverPerimeter.update.useMutation({
    onSuccess: (saved) => {
      utilities.driverPerimeter.get.setData(undefined, saved);
      void utilities.deliveries.list.invalidate();
      haptic.success();
    },
    onError: (cause) => setError(cause.message),
  });
  const basePositionMutation = trpc.driverPerimeter.updateBasePosition.useMutation({
    onSuccess: (saved) => {
      utilities.driverPerimeter.get.setData(undefined, saved);
      void utilities.deliveries.list.invalidate();
      haptic.success();
    },
    onError: (cause) => setError(cause.message),
  });

  const preferences = preferencesQuery.data;

  const togglePush = useCallback(async (next: boolean) => {
    setError("");
    setMessage("");
    if (next) {
      const outcome = await enablePush();
      if (outcome === "denied") {
        setError("Les notifications sont bloquées au niveau du système. Autorisez Tikis dans les réglages de votre téléphone, puis réessayez.");
        return;
      }
      if (outcome === "registration-failed") {
        setError("Votre téléphone n’a pas pu être enregistré pour les notifications. Vérifiez votre connexion, puis réessayez.");
        return;
      }
      if (outcome === "unsupported") {
        setMessage("Ce navigateur ne reçoit pas de notification hors application : les nouvelles courses resteront visibles dans l’app.");
      }
    }
    updateMutation.mutate({ opportunityPushEnabled: next });
  }, [enablePush, updateMutation]);

  const captureBasePosition = useCallback(async () => {
    setError("");
    setMessage("");
    setLocating(true);
    try {
      const position = await driverLocation.request();
      if (!position) {
        setError("Position GPS indisponible. Vérifiez que la localisation est activée et autorisée pour Tikis.");
        return;
      }
      await basePositionMutation.mutateAsync({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      setMessage("Position de référence mise à jour.");
    } catch {
      // Le message d'erreur est déjà posé par `onError` de la mutation ; ce catch évite qu'un refus
      // du géofencing ou du rate-limit ne remonte en rejet de promesse non gérée.
    } finally {
      setLocating(false);
    }
  }, [basePositionMutation, driverLocation]);

  if (role !== "driver") {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <Header title="Alertes & périmètre" styles={styles} theme={theme} />
        <View style={styles.centered}>
          <MaterialIcons name="notifications-off" size={34} color={theme.muted} />
          <Text style={styles.emptyTitle}>Réservé aux livreurs</Text>
          <Text style={styles.emptyText}>Ces réglages contrôlent les courses proposées aux livreurs.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (preferencesQuery.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <Header title="Alertes & périmètre" styles={styles} theme={theme} />
        <View style={styles.centered}><ActivityIndicator color={theme.primary} /></View>
      </SafeAreaView>
    );
  }

  // Sans cette branche, un échec de chargement laissait un écran en attente indéfinie, sans message
  // ni moyen de réessayer.
  if (!preferences) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <Header title="Alertes & périmètre" styles={styles} theme={theme} />
        <View style={styles.centered}>
          <MaterialIcons name="cloud-off" size={34} color={theme.muted} />
          <Text style={styles.emptyTitle}>Réglages indisponibles</Text>
          <Text style={styles.emptyText}>{preferencesQuery.error?.message ?? "Vos réglages n’ont pas pu être chargés."}</Text>
          <TikisButton label="Réessayer" icon="refresh" variant="secondary" onPress={() => void preferencesQuery.refetch()} loading={preferencesQuery.isFetching} style={styles.baseButton} />
        </View>
      </SafeAreaView>
    );
  }

  const saving = updateMutation.isPending || basePositionMutation.isPending;
  const hasBasePosition = preferences.baseLatitude !== null && preferences.baseLongitude !== null;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <Header title="Alertes & périmètre" styles={styles} theme={theme} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <View style={styles.switchRow}>
            <View style={styles.switchCopy}>
              <Text style={styles.cardTitle}>Alertes de nouvelles courses</Text>
              <Text style={styles.cardText}>
                Recevez une notification sur votre téléphone dès qu’une course compatible avec vos engins est publiée dans votre périmètre.
              </Text>
            </View>
            <Switch
              value={preferences.opportunityPushEnabled}
              onValueChange={(next) => void togglePush(next)}
              disabled={saving}
              trackColor={{ false: theme.border, true: "#C6A26A" }}
              thumbColor={preferences.opportunityPushEnabled ? "#9A6201" : "#FFFFFF"}
            />
          </View>
          <Text style={styles.cardNote}>
            Les notifications liées à vos propres courses (candidature retenue, mission confirmée, annulation) vous parviennent toujours, quel que soit ce réglage.
          </Text>
        </View>

        <RadiusSection
          styles={styles}
          icon="notifications-active"
          title="Périmètre des alertes"
          description="Au-delà de cette limite, une nouvelle course ne déclenchera pas de notification."
          value={preferences.alertRadiusKm}
          cityName={preferences.city}
          disabled={saving}
          onSelect={(radiusKm) => { setError(""); updateMutation.mutate({ alertRadiusKm: radiusKm }); }}
        />

        <RadiusSection
          styles={styles}
          icon="explore"
          title="Périmètre d’affichage"
          description="Les opportunités affichées sur votre accueil se limitent à ce périmètre."
          value={preferences.discoveryRadiusKm}
          cityName={preferences.city}
          disabled={saving}
          onSelect={(radiusKm) => { setError(""); updateMutation.mutate({ discoveryRadiusKm: radiusKm }); }}
        />

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardIcon}><MaterialIcons name="my-location" size={17} color="#9A6201" /></View>
            <Text style={styles.cardTitle}>Position de référence</Text>
          </View>
          <Text style={styles.cardText}>
            Centre de vos rayons. Sans elle, les deux périmètres retombent automatiquement sur votre ville
            {preferences.city ? ` (${preferences.city})` : ""}.
          </Text>
          <View style={[styles.baseStatus, hasBasePosition ? styles.baseStatusOk : styles.baseStatusMissing]}>
            <MaterialIcons
              name={hasBasePosition ? "check-circle" : "error-outline"}
              size={15}
              color={hasBasePosition ? "#167A55" : "#9A6200"}
            />
            <Text style={[styles.baseStatusText, { color: hasBasePosition ? "#167A55" : "#9A6200" }]}>
              {hasBasePosition ? formatBaseAge(preferences.baseUpdatedAt) : "Position non enregistrée"}
            </Text>
          </View>
          <TikisButton
            label={hasBasePosition ? "Actualiser ma position" : "Utiliser ma position actuelle"}
            icon="gps-fixed"
            variant="secondary"
            onPress={() => void captureBasePosition()}
            loading={locating || basePositionMutation.isPending}
            disabled={saving || locating}
            style={styles.baseButton}
          />
        </View>

        {error ? (
          <View style={styles.feedbackError}>
            <MaterialIcons name="error-outline" size={16} color="#B4232D" />
            <View style={styles.feedbackCopy}>
              <Text style={styles.feedbackErrorText}>{error}</Text>
              {Platform.OS !== "web" && error.includes("bloquées") ? (
                <Pressable onPress={() => void Linking.openSettings()}>
                  <Text style={styles.feedbackLink}>Ouvrir les réglages du téléphone</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}
        {message ? <Text style={styles.feedbackInfo}>{message}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({ title, styles, theme }: { title: string; styles: ReturnType<typeof makeStyles>; theme: ThemedColors }) {
  return (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Retour" onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
        <MaterialIcons name="arrow-back" size={21} color={theme.foreground} />
      </Pressable>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.back} />
    </View>
  );
}

function RadiusSection({ styles, icon, title, description, value, cityName, disabled, onSelect }: {
  styles: ReturnType<typeof makeStyles>;
  icon: "notifications-active" | "explore";
  title: string;
  description: string;
  value: RadiusChoice;
  cityName: string | null;
  disabled: boolean;
  onSelect: (radiusKm: RadiusChoice) => void;
}) {
  const options: RadiusChoice[] = [null, ...PERIMETER_RADIUS_OPTIONS_KM];
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardIcon}><MaterialIcons name={icon} size={17} color="#9A6201" /></View>
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      <Text style={styles.cardText}>{description}</Text>
      <View style={styles.choices}>
        {options.map((option) => {
          const selected = option === value;
          return (
            <Pressable
              key={option === null ? "city" : option}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              onPress={() => { if (!selected) onSelect(option); }}
              style={({ pressed }) => [styles.choice, selected && styles.choiceSelected, pressed && styles.pressed]}
            >
              <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>
                {option === null ? "Ma ville" : `${option} km`}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.cardCurrent}>Actuel : {describePerimeter(value, cityName)}</Text>
    </View>
  );
}

function makeStyles(theme: ThemedColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.background },
    header: { height: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14 },
    back: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: theme.surface },
    headerTitle: { flex: 1, textAlign: "center", color: theme.foreground, fontSize: 15, fontWeight: "700" },
    content: { padding: 16, paddingBottom: 34, gap: 12 },
    card: { backgroundColor: theme.surface, borderRadius: 12, padding: 14, gap: 9 },
    cardHeader: { flexDirection: "row", alignItems: "center", gap: 9 },
    cardIcon: { width: 30, height: 30, borderRadius: 9, backgroundColor: theme.background, alignItems: "center", justifyContent: "center" },
    cardTitle: { color: theme.foreground, fontSize: 14, fontWeight: "700" },
    cardText: { color: theme.muted, fontSize: 12.5, lineHeight: 18 },
    cardNote: { color: theme.muted, fontSize: 11.5, lineHeight: 17, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, paddingTop: 9 },
    cardCurrent: { color: "#9A6201", fontSize: 11.5, fontWeight: "700" },
    switchRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
    switchCopy: { flex: 1, gap: 4 },
    choices: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 2 },
    choice: { paddingHorizontal: 12, minHeight: 38, justifyContent: "center", borderRadius: 9, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.background },
    choiceSelected: { borderColor: "#9A6201", backgroundColor: "#F8F0E5" },
    choiceText: { color: theme.foreground, fontSize: 12.5, fontWeight: "600" },
    choiceTextSelected: { color: "#9A6201" },
    baseStatus: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8 },
    baseStatusOk: { backgroundColor: "#E6F4ED" },
    baseStatusMissing: { backgroundColor: "#FEF6E2" },
    baseStatusText: { fontSize: 11.5, fontWeight: "600", flex: 1 },
    baseButton: { minHeight: 44 },
    feedbackError: { flexDirection: "row", gap: 8, backgroundColor: "#FDEBEC", borderRadius: 9, padding: 11 },
    feedbackCopy: { flex: 1, gap: 5 },
    feedbackErrorText: { color: "#B4232D", fontSize: 12, lineHeight: 17, fontWeight: "600" },
    feedbackLink: { color: "#B4232D", fontSize: 12, fontWeight: "700", textDecorationLine: "underline" },
    feedbackInfo: { color: theme.muted, fontSize: 12, lineHeight: 17, paddingHorizontal: 2 },
    centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 28 },
    emptyTitle: { color: theme.foreground, fontSize: 15, fontWeight: "700" },
    emptyText: { color: theme.muted, fontSize: 12.5, textAlign: "center", lineHeight: 18 },
    pressed: { opacity: 0.7 },
  });
}
