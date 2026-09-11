import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TikisButton } from "@/components/tikis/ui";
import { isAllowedDeliveryText } from "@/lib/tikis-engine";
import { useThemeColors } from "@/lib/use-theme-colors";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";

const REASONS: { label: string; value: "comportement" | "sécurité" | "paiement" | "objet_endommagé" | "retard" | "autre" }[] = [
  { label: "Retard important", value: "retard" },
  { label: "Comportement inapproprié", value: "comportement" },
  { label: "Problème de sécurité", value: "sécurité" },
  { label: "Problème de paiement", value: "paiement" },
  { label: "Objet endommagé", value: "objet_endommagé" },
  { label: "Autre", value: "autre" },
];

export default function ReportDeliveryScreen() {
  const { colors: theme } = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useTikisStore();
  const deliveryQuery = trpc.deliveries.get.useQuery({ id: id ?? "00000000-0000-4000-8000-000000000000" }, { enabled: Boolean(id && profile?.phone) });
  const delivery = deliveryQuery.data;
  const [reason, setReason] = useState<typeof REASONS[number]["value"]>(REASONS[0].value);
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const reportMutation = trpc.reports.create.useMutation();

  async function send() {
    if (!id) return;
    if (description.trim().length < 10) { setError("Décrivez le problème en quelques mots (10 caractères minimum)."); return; }
    if (!isAllowedDeliveryText(description)) { setError("Caractères non autorisés"); return; }
    setError("");
    try {
      await reportMutation.mutateAsync({ deliveryId: id, reason, description: description.trim() });
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Le signalement n’a pas pu être envoyé. Réessayez.");
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.topBar}>
            <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.back, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && styles.pressed]}>
              <MaterialIcons name="arrow-back" size={22} color={theme.foreground} />
            </Pressable>
            <Text style={[styles.topTitle, { color: theme.foreground }]}>Signaler</Text>
            <View style={styles.space} />
          </View>
          {sent ? (
            <View style={styles.success}>
              <View style={[styles.successIcon, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <MaterialIcons name="check-circle" size={32} color={theme.success} />
              </View>
              <Text style={[styles.successTitle, { color: theme.foreground }]}>Signalement envoyé</Text>
              <Text style={[styles.successText, { color: theme.muted }]}>Merci. Votre signalement concernant « {delivery?.title ?? "cette livraison"} » a été transmis à l’administration Tikis et sera conservé dans la chronologie.</Text>
              <TikisButton label="Retour à la livraison" onPress={() => router.back()} style={styles.successButton} />
            </View>
          ) : (
            <>
              <Text style={[styles.title, { color: theme.foreground }]}>Aidez-nous à comprendre.</Text>
              <Text style={[styles.subtitle, { color: theme.muted }]}>Votre signalement est traité de manière confidentielle par l’équipe Tikis.</Text>
              <Text style={[styles.label, { color: theme.muted }]}>MOTIF</Text>
              <View style={styles.reasons}>
                {REASONS.map((item) => (
                  <Pressable
                    key={item.value}
                    onPress={() => setReason(item.value)}
                    style={({ pressed }) => [
                      styles.reason,
                      { backgroundColor: theme.surface, borderColor: theme.border },
                      reason === item.value && { backgroundColor: theme.surface, borderColor: theme.primary },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.reasonText, { color: theme.muted }, reason === item.value && { color: theme.primary }]}>{item.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={[styles.label, { color: theme.muted }]}>DÉCRIVEZ LA SITUATION</Text>
              <TextInput
                value={description}
                onChangeText={(value) => { setDescription(value); setError(""); }}
                placeholder="Expliquez ce qui s’est passé…"
                placeholderTextColor={theme.muted}
                multiline
                textAlignVertical="top"
                style={[styles.textarea, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.foreground }]}
              />
              {error ? <Text style={[styles.error, { color: theme.error }]}>{error}</Text> : null}
              <View style={[styles.attach, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <MaterialIcons name="attach-file" size={20} color={theme.primary} />
                <View style={styles.attachTextWrap}>
                  <Text style={[styles.attachTitle, { color: theme.foreground }]}>Pièces jointes</Text>
                  <Text style={[styles.attachText, { color: theme.muted }]}>Vous pourrez ajouter des photos ou documents lors de l’intégration serveur.</Text>
                </View>
              </View>
              <TikisButton label="Envoyer le signalement" icon="send" onPress={() => void send()} loading={reportMutation.isPending} style={styles.submit} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  keyboard: { flex: 1 },
  content: { padding: 16, paddingBottom: 28 },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 17 },
  back: { width: 40, height: 40, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  topTitle: { fontSize: 16, fontWeight: "600" },
  space: { width: 40 },
  title: { fontSize: 24, fontWeight: "700", letterSpacing: -0.4 },
  subtitle: { fontSize: 14, lineHeight: 20, marginTop: 8 },
  label: { fontSize: 11, fontWeight: "600", letterSpacing: 0.7, marginTop: 20, marginBottom: 8 },
  reasons: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  reason: { paddingHorizontal: 11, paddingVertical: 9, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  reasonText: { fontWeight: "600", fontSize: 12 },
  textarea: { minHeight: 130, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, padding: 13, fontSize: 14, lineHeight: 20 },
  error: { fontSize: 12, marginTop: 8, fontWeight: "600" },
  attach: { marginTop: 14, padding: 12, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 10 },
  attachTextWrap: { flex: 1 },
  attachTitle: { fontSize: 13, fontWeight: "600" },
  attachText: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  submit: { marginTop: 18 },
  success: { alignItems: "center", paddingTop: 50, paddingHorizontal: 15 },
  successIcon: { width: 64, height: 64, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  successTitle: { fontSize: 20, fontWeight: "700", marginTop: 14 },
  successText: { fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 8 },
  successButton: { alignSelf: "stretch", marginTop: 24 },
  pressed: { opacity: 0.7 },
});
