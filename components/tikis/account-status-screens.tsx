import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TikisButton } from "@/components/tikis/ui";
import { useTikisLogout } from "@/lib/tikis-logout";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { haptic } from "@/lib/haptics";
import { computeDaysRemaining as daysRemaining } from "@/server/_test-helpers/deletion-flow";

/** Écran plein bloquant l'ensemble de l'app quand le mode maintenance est actif. */
export function MaintenanceScreen({ message }: { message?: string }) {
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.center}>
        <View style={[styles.iconWrap, { backgroundColor: "#E5F6F7" }]}>
          <MaterialIcons name="build" size={38} color="#007B8B" />
        </View>
        <Text style={styles.title}>Tikis est en maintenance</Text>
        <Text style={styles.text}>{message?.trim() || "Nous améliorons votre expérience. L’application sera de nouveau disponible très bientôt. Merci de votre patience."}</Text>
      </View>
    </SafeAreaView>
  );
}

/** Écran plein pour un compte banni : bloque l'accès au reste de l'app, permet de se déconnecter. */
export function BannedAccountScreen({ reason }: { reason?: string }) {
  const { openLogoutConfirmation } = useTikisLogout();
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.center}>
        <View style={[styles.iconWrap, { backgroundColor: "#FDECEA" }]}>
          <MaterialIcons name="block" size={38} color="#B4232D" />
        </View>
        <Text style={styles.title}>Compte banni</Text>
        <Text style={styles.text}>Votre compte Tikis a été définitivement banni par l’équipe de modération.{reason ? `\n\nMotif : ${reason}` : ""}</Text>
        <Text style={styles.hint}>Si vous pensez qu’il s’agit d’une erreur, contactez le support Tikis en indiquant votre numéro de téléphone.</Text>
        <TikisButton label="Se déconnecter" variant="secondary" icon="logout" onPress={openLogoutConfirmation} style={styles.button} />
      </View>
    </SafeAreaView>
  );
}

/** Écran plein pour un compte dont la suppression est en cours : permet d'annuler avant la date de finalisation. */
export function DeletionPendingScreen({ deletionScheduledAt }: { deletionScheduledAt?: string }) {
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
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.center}>
        <View style={[styles.iconWrap, { backgroundColor: "#FFF7E6" }]}>
          <MaterialIcons name="hourglass-bottom" size={38} color="#9A6201" />
        </View>
        <Text style={styles.title}>Suppression de compte en cours</Text>
        <Text style={styles.text}>
          Vous avez demandé la suppression définitive de votre compte Tikis.{"\n\n"}
          {remaining > 0
            ? `Il vous reste ${remaining} jour${remaining > 1 ? "s" : ""} pour changer d’avis. Passé ce délai, vos données personnelles seront définitivement supprimées.`
            : "Le délai d’annulation est écoulé ; la suppression sera finalisée très prochainement."}
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TikisButton label="Annuler la suppression" icon="restore" onPress={() => void cancel()} loading={cancelMutation.isPending} style={styles.button} />
        <Pressable onPress={openLogoutConfirmation} style={({ pressed }) => [styles.logoutLink, pressed && styles.pressed]}>
          {cancelMutation.isPending ? <ActivityIndicator size="small" color="#697386" /> : <Text style={styles.logoutLinkText}>Se déconnecter</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F6F8FC" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28 },
  iconWrap: { width: 78, height: 78, borderRadius: 26, alignItems: "center", justifyContent: "center", marginBottom: 22 },
  title: { color: "#0B1F3A", fontSize: 24, fontWeight: "900", textAlign: "center" },
  text: { color: "#697386", fontSize: 14.5, lineHeight: 22, textAlign: "center", marginTop: 12 },
  hint: { color: "#8A96A8", fontSize: 12.5, lineHeight: 19, textAlign: "center", marginTop: 16 },
  error: { color: "#C23B45", fontSize: 13, fontWeight: "700", textAlign: "center", marginTop: 16 },
  button: { marginTop: 26, minWidth: 220 },
  logoutLink: { marginTop: 18, paddingVertical: 10, paddingHorizontal: 16 },
  logoutLinkText: { color: "#697386", fontSize: 13, fontWeight: "800" },
  pressed: { opacity: 0.65 },
});
