import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TikisButton } from "@/components/tikis/ui";
import { useTikisLogout } from "@/lib/tikis-logout";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { haptic } from "@/lib/haptics";
import { useThemeColors } from "@/lib/use-theme-colors";
import { computeDaysRemaining as daysRemaining } from "@/server/_test-helpers/deletion-flow";

/** Écran plein bloquant l'ensemble de l'app quand le mode maintenance est actif. */
export function MaintenanceScreen({ message }: { message?: string }) {
  const { colors: theme } = useThemeColors();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={["top", "bottom"]}>
      <View style={styles.center}>
        <View style={[styles.iconWrap, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <MaterialIcons name="build" size={38} color={theme.primary} />
        </View>
        <Text style={[styles.title, { color: theme.foreground }]}>Tikis est en maintenance</Text>
        <Text style={[styles.text, { color: theme.muted }]}>{message?.trim() || "Nous améliorons votre expérience. L’application sera de nouveau disponible très bientôt. Merci de votre patience."}</Text>
      </View>
    </SafeAreaView>
  );
}

/** Écran plein pour un compte banni : bloque l'accès au reste de l'app, permet de se déconnecter. */
export function BannedAccountScreen({ reason }: { reason?: string }) {
  const { colors: theme } = useThemeColors();
  const { openLogoutConfirmation } = useTikisLogout();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={["top", "bottom"]}>
      <View style={styles.center}>
        <View style={[styles.iconWrap, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <MaterialIcons name="block" size={38} color={theme.error} />
        </View>
        <Text style={[styles.title, { color: theme.foreground }]}>Compte banni</Text>
        <Text style={[styles.text, { color: theme.muted }]}>Votre compte Tikis a été définitivement banni par l’équipe de modération.{reason ? `\n\nMotif : ${reason}` : ""}</Text>
        <Text style={[styles.hint, { color: theme.muted }]}>Si vous pensez qu’il s’agit d’une erreur, contactez le support Tikis en indiquant votre numéro de téléphone.</Text>
        <TikisButton label="Se déconnecter" variant="secondary" icon="logout" onPress={openLogoutConfirmation} style={styles.button} />
      </View>
    </SafeAreaView>
  );
}

/** Écran plein pour un compte dont la suppression est en cours : permet d'annuler avant la date de finalisation. */
export function DeletionPendingScreen({ deletionScheduledAt }: { deletionScheduledAt?: string }) {
  const { colors: theme } = useThemeColors();
  const { openLogoutConfirmation } = useTikisLogout();
  const { registerProfile } = useTikisStore();
  const cancelMutation = trpc.profiles.cancelDeletion.useMutation();
  const [error, setError] = useState("");
  const remaining = daysRemaining(deletionScheduledAt);

  async function cancel() {
    setError("");
    try {
      const profile = await cancelMutation.mutateAsync();
      registerProfile(profile);
      haptic.success();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "L’annulation n’a pas pu être enregistrée. Réessayez.");
      haptic.error();
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={["top", "bottom"]}>
      <View style={styles.center}>
        <View style={[styles.iconWrap, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <MaterialIcons name="hourglass-bottom" size={38} color={theme.primary} />
        </View>
        <Text style={[styles.title, { color: theme.foreground }]}>Suppression de compte en cours</Text>
        <Text style={[styles.text, { color: theme.muted }]}>
          Vous avez demandé la suppression définitive de votre compte Tikis.{"\n\n"}
          {remaining > 0
            ? `Il vous reste ${remaining} jour${remaining > 1 ? "s" : ""} pour changer d’avis. Passé ce délai, vos données personnelles seront définitivement supprimées.`
            : "Le délai d’annulation est écoulé ; la suppression sera finalisée très prochainement."}
        </Text>
        {error ? <Text style={[styles.error, { color: theme.error }]}>{error}</Text> : null}
        <TikisButton label="Annuler la suppression" icon="restore" onPress={() => void cancel()} loading={cancelMutation.isPending} style={styles.button} />
        <Pressable onPress={openLogoutConfirmation} style={({ pressed }) => [styles.logoutLink, pressed && styles.pressed]}>
          {cancelMutation.isPending ? <ActivityIndicator size="small" color={theme.muted} /> : <Text style={[styles.logoutLinkText, { color: theme.muted }]}>Se déconnecter</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28 },
  iconWrap: { width: 76, height: 76, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 22, borderWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 22, fontWeight: "700", textAlign: "center", letterSpacing: -0.3 },
  text: { fontSize: 14.5, lineHeight: 22, textAlign: "center", marginTop: 12 },
  hint: { fontSize: 12.5, lineHeight: 19, textAlign: "center", marginTop: 16 },
  error: { fontSize: 13, fontWeight: "600", textAlign: "center", marginTop: 16 },
  button: { marginTop: 26, minWidth: 220 },
  logoutLink: { marginTop: 18, paddingVertical: 10, paddingHorizontal: 16 },
  logoutLinkText: { fontSize: 13, fontWeight: "600" },
  pressed: { opacity: 0.7 },
});
