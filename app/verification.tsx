import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { KycUploader } from "@/components/tikis/kyc-uploader";
import { SurfaceCard, TikisButton } from "@/components/tikis/ui";
import { useKyc } from "@/hooks/use-kyc";
import { useTikisStore } from "@/lib/tikis-store";
import { haptic } from "@/lib/haptics";

const STEP_COPY = {
  "id-front": {
    title: "Recto de la pièce d’identité",
    description: "Photographiez la face avant de votre CNI, passeport ou permis. Texte lisible, pas de reflet.",
  },
  "id-back": {
    title: "Verso de la pièce d’identité",
    description: "Photographiez maintenant la face arrière. Même exigence de netteté et de lisibilité.",
  },
  selfie: {
    title: "Selfie de vérification",
    description: "Prenez un selfie net, visage dégagé, sans lunettes ni chapeau. Conditions d’éclairage normales.",
  },
} as const;

export default function VerificationScreen() {
  const { role, profile } = useTikisStore();
  const { state, progress, loadingKind, pickDocument, clearDocument, submit } = useKyc();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!profile) return null;
  if (role !== "driver") {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Retour" onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><MaterialIcons name="arrow-back" size={22} color="#111111" /></Pressable><Text style={styles.headerTitle}>Vérification d’identité</Text></View>
        <View style={styles.notice}><MaterialIcons name="info" size={22} color="#007B8B" /><Text style={styles.noticeTitle}>Réservé aux livreurs</Text><Text style={styles.noticeText}>La vérification d’identité concerne uniquement les comptes livreurs. Votre rôle actuel est “Expéditeur”.</Text></View>
      </SafeAreaView>
    );
  }

  const submitted = state.submission.status === "submitted";
  const approved = state.submission.status === "approved";

  async function handleSubmit() {
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const result = await submit();
      if (!result.ok) {
        haptic.error();
        setError(result.error);
        return;
      }
      haptic.success();
      Alert.alert("Vérification envoyée", "Nous examinons vos documents sous 24 heures. Vous serez notifié dès la validation.", [{ text: "Compris", onPress: () => router.back() }]);
    } catch (cause) {
      haptic.error();
      setError(cause instanceof Error ? cause.message : "L'envoi a échoué. Réessayez dans un instant.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Retour" onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
          <MaterialIcons name="arrow-back" size={22} color="#111111" />
        </Pressable>
        <View>
          <Text style={styles.title}>Vérification d’identité</Text>
          <Text style={styles.subtitle}>Confirmez votre profil pour accéder aux livraisons.</Text>
        </View>
      </View>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {approved ? (
            <SurfaceCard style={styles.approvedCard}>
              <View style={styles.approvedIcon}><MaterialIcons name="verified" size={28} color="#167A55" /></View>
              <Text style={styles.approvedTitle}>Profil validé</Text>
              <Text style={styles.approvedText}>Vous pouvez désormais postuler aux livraisons. La communauté Tikis vous fait confiance.</Text>
            </SurfaceCard>
          ) : (
            <>
              <SurfaceCard style={styles.summary}>
                <View style={styles.summaryRow}>
                  <MaterialIcons name="privacy-tip" size={20} color="#007B8B" />
                  <View style={styles.summaryCopy}>
                    <Text style={styles.summaryTitle}>Pourquoi cette vérification ?</Text>
                    <Text style={styles.summaryText}>Elle sécurise la communauté et vous permet de candidater aux livraisons. Vos documents sont stockés de manière chiffrée et ne sont jamais partagés.</Text>
                  </View>
                </View>
              </SurfaceCard>

              <View style={styles.progressCard}>
                <View style={styles.progressHeader}>
                  <Text style={styles.progressLabel}>Progression</Text>
                  <Text style={styles.progressValue}>{progress.done}/{progress.total}</Text>
                </View>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${(progress.done / progress.total) * 100}%` }]} />
                </View>
                <Text style={styles.progressHint}>{progress.complete ? "Tous les documents sont prêts." : "Ajoutez les trois documents ci-dessous."}</Text>
              </View>

              <KycUploader kind="id-front" title={STEP_COPY["id-front"].title} description={STEP_COPY["id-front"].description} capture={state.documents["id-front"] ?? null} loading={loadingKind === "id-front"} onPick={() => { void pickDocument("id-front"); }} onClear={() => clearDocument("id-front")} />
              <KycUploader kind="id-back" title={STEP_COPY["id-back"].title} description={STEP_COPY["id-back"].description} capture={state.documents["id-back"] ?? null} loading={loadingKind === "id-back"} onPick={() => { void pickDocument("id-back"); }} onClear={() => clearDocument("id-back")} />
              <KycUploader kind="selfie" title={STEP_COPY.selfie.title} description={STEP_COPY.selfie.description} capture={state.documents.selfie ?? null} loading={loadingKind === "selfie"} onPick={() => { void pickDocument("selfie"); }} onClear={() => clearDocument("selfie")} />

              {error ? <Text style={styles.error}>{error}</Text> : null}

              {submitted ? (
                <SurfaceCard style={styles.submittedCard}>
                  <View style={styles.submittedIcon}><MaterialIcons name="hourglass-top" size={26} color="#9A6200" /></View>
                  <Text style={styles.submittedTitle}>Vérification en cours</Text>
                  <Text style={styles.submittedText}>Votre dossier est entre les mains de notre équipe. Délai habituel : 24 heures ouvrées.</Text>
                </SurfaceCard>
              ) : (
                <TikisButton label="Envoyer la vérification" icon="send" onPress={() => void handleSubmit()} loading={submitting} loadingLabel="Envoi en cours…" disabled={!progress.complete || submitting} />
              )}

              <Text style={styles.disclaimer}>En soumettant, vous certifiez que les documents vous appartiennent. Toute falsification entraîne la suspension immédiate du compte.</Text>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#EEEDF3" },
  header: { minHeight: 64, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, backgroundColor: "#FFFFFF", flexDirection: "row", alignItems: "center", gap: 10 },
  back: { width: 40, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#EEEDF3" },
  title: { color: "#111111", fontSize: 17, fontWeight: "600" },
  subtitle: { color: "#666666", fontSize: 12, marginTop: 2 },
  keyboard: { flex: 1 },
  content: { padding: 14, paddingBottom: 36, gap: 12 },
  summary: { padding: 12 },
  summaryRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  summaryCopy: { flex: 1 },
  summaryTitle: { color: "#111111", fontSize: 13, fontWeight: "600" },
  summaryText: { color: "#444444", fontSize: 12, lineHeight: 17, marginTop: 2 },
  progressCard: { backgroundColor: "#FFFFFF", borderRadius: 10, padding: 12, gap: 6 },
  progressHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  progressLabel: { color: "#747474", fontSize: 10, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase" },
  progressValue: { color: "#111111", fontSize: 13, fontWeight: "600" },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: "#EEEDF3", overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: "#007B8B" },
  progressHint: { color: "#666666", fontSize: 11, marginTop: 2 },
  approvedCard: { padding: 16, alignItems: "center", gap: 8 },
  approvedIcon: { width: 52, height: 52, borderRadius: 14, backgroundColor: "#EEEDF3", alignItems: "center", justifyContent: "center" },
  approvedTitle: { color: "#111111", fontSize: 16, fontWeight: "600" },
  approvedText: { color: "#444444", fontSize: 12, lineHeight: 18, textAlign: "center" },
  submittedCard: { padding: 14, alignItems: "center", gap: 7 },
  submittedIcon: { width: 48, height: 48, borderRadius: 12, backgroundColor: "#EEEDF3", alignItems: "center", justifyContent: "center" },
  submittedTitle: { color: "#111111", fontSize: 14, fontWeight: "600" },
  submittedText: { color: "#444444", fontSize: 12, lineHeight: 17, textAlign: "center" },
  error: { color: "#B4232D", fontSize: 12, fontWeight: "600" },
  disclaimer: { color: "#666666", fontSize: 11, lineHeight: 16, textAlign: "center" },
  notice: { margin: 16, backgroundColor: "#FFFFFF", borderRadius: 10, padding: 14, alignItems: "center", gap: 7 },
  noticeTitle: { color: "#111111", fontSize: 14, fontWeight: "600" },
  noticeText: { color: "#444444", fontSize: 12, textAlign: "center" },
  headerTitle: { color: "#111111", fontSize: 17, fontWeight: "600" },
  pressed: { opacity: 0.67 },
});
